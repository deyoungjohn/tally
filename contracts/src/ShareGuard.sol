// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title ShareGuard v1
/// @notice Slippage protection measured in SHARES of the underlying stock, not in tokens.
///         One token of a tokenized stock is `multiplier` shares, and the multiplier differs per
///         issuer (Ondo NFLX = 10.0, bStock NFLX = 1.0). ShareGuard is the trader: it pulls
///         `tokenIn` from the caller, runs an allow-listed router with the aggregator calldata
///         (built with userWalletAddress = this contract), converts what arrived into shares and
///         reverts below `minShares`.
/// @dev Differences from the spike (spike/shareguard/src/ShareGuard.sol, which must never be
///      deployed): the router and its approve target are owner-allow-listed (the spike called any
///      caller-supplied address, so `router = USDT, data = transferFrom(victim, ...)` drained
///      anyone who had approved it); approvals are exact and reset to 0; the guard is
///      non-reentrant, pausable and deadline-bound; token-level pauses are honoured; Ondo, which
///      has no on-chain multiplier, uses a pull-style signed feed bounded per asset. Not
///      upgradeable. The guard holds no balances between transactions.
contract ShareGuard is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    enum Source {
        None,
        UiMultiplier, // bStock: token.uiMultiplier()
        Multiplier, // xStocks: token.multiplier() (data only; Tally never routes there)
        Feed // Ondo: no on-chain multiplier; signed feed bounded by maxStepBps and corporate actions
    }

    enum PauseCheck {
        None,
        Manager, // manager.isTokenPaused(stock); manager is `pauseManager`, or token.tokenPauseManager() if 0
        TokenFlag // token.isPaused() (xStocks)
    }

    /// @dev Owner-managed configuration of one stock token.
    struct Asset {
        Source source;
        bool enabled;
        uint16 maxStepBps; // Feed only: largest accepted increase per update, in basis points
        PauseCheck pauseCheck;
        address pauseManager; // PauseCheck.Manager only; 0 = read tokenPauseManager() from the token
    }

    /// @dev Feed state of a Feed asset.
    struct FeedState {
        uint256 multiplier; // shares per token, 1e18; 0 = never seeded
        uint64 updatedAt; // when this value was last accepted (block time)
        uint64 validAfter; // validAfter of the last accepted update (monotonic)
    }

    /// @dev What the feed signer signs (EIP-712).
    struct FeedUpdate {
        address stock;
        uint256 multiplier;
        uint64 validAfter;
        uint64 validUntil;
    }

    /// @dev A reverse or forward split (or any change beyond maxStepBps) the owner expects.
    struct CorporateAction {
        uint256 expectedMultiplier;
        uint64 notBefore;
        bool registered;
    }

    struct Swap {
        address tokenIn;
        uint256 amountIn;
        address stock;
        uint256 minShares;
        address router;
        bytes routerData;
        address recipient;
        uint256 deadline;
    }

    // ------------------------------------------------------------ constants

    bytes32 public constant FEED_UPDATE_TYPEHASH =
        keccak256("FeedUpdate(address stock,uint256 multiplier,uint64 validAfter,uint64 validUntil)");
    uint16 public constant MAX_STEP_BPS_CAP = 1000; // 10%: a configuration slip cannot open the bound
    uint64 public constant MIN_MAX_AGE = 1 hours;
    uint64 public constant MAX_MAX_AGE = 7 days;

    // -------------------------------------------------------------- storage

    mapping(address router => bool) public allowedRouter;
    mapping(address router => address) public approveTargetOf;
    mapping(address stock => Asset) private _asset;
    mapping(address stock => FeedState) public feedOf;
    mapping(address stock => CorporateAction) public corporateActionOf;
    address public feedSigner;
    uint64 public maxAge = 3 days;

    // --------------------------------------------------------------- events

    event Guarded(
        address indexed user,
        address indexed recipient,
        address indexed stock,
        address tokenIn,
        uint256 amountIn,
        uint256 tokensOut,
        uint256 shares,
        uint256 multiplier,
        address router
    );
    event AssetSet(
        address indexed stock,
        Source source,
        bool enabled,
        uint16 maxStepBps,
        PauseCheck pauseCheck,
        address pauseManager
    );
    event RouterSet(address indexed router, bool allowed, address approveTarget);
    event FeedUpdated(
        address indexed stock, uint256 multiplier, uint256 previous, uint64 validAfter, uint64 updatedAt
    );
    event FeedSeeded(address indexed stock, uint256 multiplier);
    event CorporateActionRegistered(address indexed stock, uint256 expectedMultiplier, uint64 notBefore);
    event CorporateActionCleared(address indexed stock, bool consumed);
    event FeedSignerSet(address indexed signer);
    event MaxAgeSet(uint64 maxAge);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    // --------------------------------------------------------------- errors

    error Expired(uint256 deadline);
    error ZeroAmount();
    error ZeroMinShares();
    error ZeroAddress();
    error SameToken();
    error RouterNotAllowed(address router);
    error InvalidRouterConfig(address router);
    error InvalidAssetConfig(address stock);
    error AssetNotEnabled(address stock);
    error TokenPaused(address stock);
    error PauseCheckFailed(address stock);
    error MultiplierUnavailable(address stock);
    error NoOutput();
    error InsufficientShares(uint256 shares, uint256 minShares);
    error RouterCallFailed(bytes reason);
    error NotAFeedAsset(address stock);
    error FeedStale(address stock, uint64 updatedAt, uint64 maxAge);
    error FeedNotSeeded(address stock);
    error InvalidSigner();
    error UpdateNotValidNow(uint64 validAfter, uint64 validUntil);
    error UpdateOlderThanStored(uint64 validAfter, uint64 storedValidAfter);
    error UpdateConflictsWithStored(uint64 validAfter);
    error UpdateOutOfBounds(address stock, uint256 current, uint256 proposed);
    error CorporateActionNotReady(address stock, uint64 notBefore);
    error InvalidMaxAge(uint64 maxAge);
    error NativeRescueFailed();

    // ---------------------------------------------------------- constructor

    constructor(address owner_, address feedSigner_) Ownable(owner_) EIP712("ShareGuard", "1") {
        feedSigner = feedSigner_;
        emit FeedSignerSet(feedSigner_);
    }

    // ----------------------------------------------------------- owner: lists

    /// @notice Allow-list (or remove) an aggregator router and set the address that must be
    ///         approved to pull `tokenIn` (for the Binance Trading API both are 0xB444…dDA5).
    function setRouter(address router, bool allowed, address approveTarget) external onlyOwner {
        if (allowed) {
            if (
                router == address(0) || approveTarget == address(0) || router == address(this)
                    || approveTarget == address(this) || _asset[router].source != Source.None
                    || _asset[approveTarget].source != Source.None
            ) revert InvalidRouterConfig(router);
            allowedRouter[router] = true;
            approveTargetOf[router] = approveTarget;
        } else {
            delete allowedRouter[router];
            delete approveTargetOf[router];
            approveTarget = address(0);
        }
        emit RouterSet(router, allowed, approveTarget);
    }

    /// @notice Configure a stock token. `seedMultiplier` is the owner-vouched first value of a
    ///         Feed asset (there is no previous value to bound it against); it applies only while
    ///         the feed has never been seeded. After that only signed, bounded updates move it.
    function setAsset(address stock, Asset calldata cfg, uint256 seedMultiplier) external onlyOwner {
        if (
            stock == address(0) || stock == address(this) || stock.code.length == 0 || allowedRouter[stock]
                || approveTargetOf[stock] != address(0) || cfg.source == Source.None
                || cfg.maxStepBps > MAX_STEP_BPS_CAP
                || (cfg.source == Source.Feed && cfg.maxStepBps == 0 && cfg.enabled)
                || (cfg.pauseCheck != PauseCheck.Manager && cfg.pauseManager != address(0))
        ) revert InvalidAssetConfig(stock);
        _asset[stock] = cfg;
        emit AssetSet(stock, cfg.source, cfg.enabled, cfg.maxStepBps, cfg.pauseCheck, cfg.pauseManager);

        if (cfg.source == Source.Feed && seedMultiplier != 0 && feedOf[stock].multiplier == 0) {
            feedOf[stock] = FeedState(seedMultiplier, uint64(block.timestamp), 0);
            emit FeedSeeded(stock, seedMultiplier);
        }
    }

    function assetOf(address stock) external view returns (Asset memory) {
        return _asset[stock];
    }

    /// @notice Register the one corporate action (split) the owner expects for `stock`. The feed
    ///         signer alone can never produce a decrease or an increase above `maxStepBps`.
    function registerCorporateAction(address stock, uint256 expectedMultiplier, uint64 notBefore)
        external
        onlyOwner
    {
        if (_asset[stock].source != Source.Feed) revert NotAFeedAsset(stock);
        if (expectedMultiplier == 0) revert MultiplierUnavailable(stock);
        corporateActionOf[stock] = CorporateAction(expectedMultiplier, notBefore, true);
        emit CorporateActionRegistered(stock, expectedMultiplier, notBefore);
    }

    function clearCorporateAction(address stock) external onlyOwner {
        delete corporateActionOf[stock];
        emit CorporateActionCleared(stock, false);
    }

    function setFeedSigner(address signer) external onlyOwner {
        feedSigner = signer; // address(0) disables feed updates
        emit FeedSignerSet(signer);
    }

    function setMaxAge(uint64 maxAge_) external onlyOwner {
        if (maxAge_ < MIN_MAX_AGE || maxAge_ > MAX_MAX_AGE) revert InvalidMaxAge(maxAge_);
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    /// @notice Emergency stop for NEW swaps. It cannot trap funds: none are held between
    ///         transactions.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Sweep tokens (or native currency with token = address(0)) that were sent here by
    ///         mistake. The guard never holds user funds between transactions, and this cannot
    ///         run inside a swap.
    function rescue(address token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount;
        if (token == address(0)) {
            amount = address(this).balance;
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeRescueFailed();
        } else {
            amount = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransfer(to, amount);
        }
        emit Rescued(token, to, amount);
    }

    // ------------------------------------------------------------ multipliers

    /// @notice Shares per token (1e18) the guard would use right now. Reverts if the asset is
    ///         unknown, its source fails, or a Feed asset is stale.
    function sharesPerToken(address stock) public view returns (uint256 m) {
        Asset memory a = _asset[stock];
        if (a.source == Source.UiMultiplier) {
            m = _readUint(stock, 0xa60bf13d); // uiMultiplier()
        } else if (a.source == Source.Multiplier) {
            m = _readUint(stock, 0x1b3ed722); // multiplier()
        } else if (a.source == Source.Feed) {
            FeedState memory f = feedOf[stock];
            if (f.multiplier == 0) revert FeedNotSeeded(stock);
            if (block.timestamp > uint256(f.updatedAt) + maxAge) revert FeedStale(stock, f.updatedAt, maxAge);
            m = f.multiplier;
        } else {
            revert AssetNotEnabled(stock);
        }
        if (m == 0) revert MultiplierUnavailable(stock);
    }

    function toShares(address stock, uint256 tokens) public view returns (uint256) {
        return tokens * sharesPerToken(stock) / 1e18;
    }

    function _readUint(address target, uint32 selector) private view returns (uint256 v) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSelector(bytes4(selector)));
        if (!ok || ret.length != 32) revert MultiplierUnavailable(target);
        v = abi.decode(ret, (uint256));
    }

    // ------------------------------------------------------------------ swap

    /// @notice Buy `stock` with `tokenIn` through an allow-listed router and revert unless the
    ///         result is worth at least `minShares` shares. `routerData` must be swap calldata
    ///         built for this contract's address. Needs `allowance(msg.sender, this) >= amountIn`.
    function swapForShares(
        address tokenIn,
        uint256 amountIn,
        address stock,
        uint256 minShares,
        address router,
        bytes calldata routerData,
        address recipient,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        Swap memory s = Swap(tokenIn, amountIn, stock, minShares, router, routerData, recipient, deadline);
        shares = _swap(s, sharesPerTokenForSwap(stock));
    }

    /// @notice Same, for an Ondo (Feed) asset, first applying a signed multiplier update so a
    ///         swap needs no separate keeper transaction. The update is bounded by the asset's
    ///         maxStepBps; anything larger needs a matching owner-registered CorporateAction.
    function swapForSharesWithFeed(
        address tokenIn,
        uint256 amountIn,
        address stock,
        uint256 minShares,
        address router,
        bytes calldata routerData,
        address recipient,
        uint256 deadline,
        FeedUpdate calldata u,
        bytes calldata sig
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        if (u.stock != stock) revert NotAFeedAsset(u.stock);
        _applyUpdate(u, sig);
        Swap memory s = Swap(tokenIn, amountIn, stock, minShares, router, routerData, recipient, deadline);
        shares = _swap(s, sharesPerTokenForSwap(stock));
    }

    /// @dev `sharesPerToken` plus the "asset must be enabled" check that swaps need.
    function sharesPerTokenForSwap(address stock) private view returns (uint256) {
        if (!_asset[stock].enabled) revert AssetNotEnabled(stock);
        return sharesPerToken(stock);
    }

    function _swap(Swap memory s, uint256 m) private returns (uint256 shares) {
        if (block.timestamp > s.deadline) revert Expired(s.deadline);
        if (s.amountIn == 0) revert ZeroAmount();
        if (s.minShares == 0) revert ZeroMinShares();
        if (s.recipient == address(0)) revert ZeroAddress();
        if (s.tokenIn == s.stock) revert SameToken();
        // The arbitrary-call fix: only allow-listed routers, never a token contract.
        if (!allowedRouter[s.router] || s.router == s.tokenIn || s.router == s.stock) {
            revert RouterNotAllowed(s.router);
        }
        address approveTarget = approveTargetOf[s.router];
        if (approveTarget == s.tokenIn || approveTarget == s.stock) revert RouterNotAllowed(s.router);
        _checkNotPaused(s.stock);

        IERC20 tokenIn = IERC20(s.tokenIn);
        IERC20 stock = IERC20(s.stock);
        uint256 inBefore = tokenIn.balanceOf(address(this));
        uint256 stockBefore = stock.balanceOf(address(this));

        tokenIn.safeTransferFrom(msg.sender, address(this), s.amountIn);
        tokenIn.forceApprove(approveTarget, s.amountIn);
        (bool ok, bytes memory ret) = s.router.call(s.routerData);
        if (!ok) revert RouterCallFailed(ret);
        tokenIn.forceApprove(approveTarget, 0);

        uint256 out = stock.balanceOf(address(this)) - stockBefore;
        if (out == 0) revert NoOutput();
        shares = out * m / 1e18;
        if (shares < s.minShares) revert InsufficientShares(shares, s.minShares);

        stock.safeTransfer(s.recipient, out);
        uint256 leftover = tokenIn.balanceOf(address(this)) - inBefore;
        if (leftover > 0) tokenIn.safeTransfer(msg.sender, leftover);

        _emitGuarded(s, out, shares, m);
    }

    function _emitGuarded(Swap memory s, uint256 out, uint256 shares, uint256 m) private {
        emit Guarded(msg.sender, s.recipient, s.stock, s.tokenIn, s.amountIn, out, shares, m, s.router);
    }

    /// @notice Post-trade check for a wallet that trades itself and calls this afterwards in the
    ///         same transaction (an EIP-7702 batch): reverts unless `account` gained at least
    ///         `minShares` shares of `stock`.
    function assertMinShares(address account, address stock, uint256 balanceBefore, uint256 minShares)
        external
        view
        returns (uint256 shares)
    {
        uint256 bal = IERC20(stock).balanceOf(account);
        if (bal <= balanceBefore) revert NoOutput();
        shares = toShares(stock, bal - balanceBefore);
        if (shares < minShares) revert InsufficientShares(shares, minShares);
    }

    // ------------------------------------------------------------ token pause

    /// @notice True if the issuer has paused `stock`. Reverts if the check cannot be answered
    ///         (fail closed).
    function isTokenPaused(address stock) public view returns (bool) {
        Asset memory a = _asset[stock];
        if (a.pauseCheck == PauseCheck.Manager) {
            address manager = a.pauseManager;
            if (manager == address(0)) {
                (bool okM, bytes memory retM) = stock.staticcall(abi.encodeWithSelector(0x461ad792)); // tokenPauseManager()
                if (!okM || retM.length != 32) revert PauseCheckFailed(stock);
                manager = abi.decode(retM, (address));
                if (manager == address(0) || manager.code.length == 0) revert PauseCheckFailed(stock);
            }
            // isTokenPaused(address) = 0x5e76ad54
            (bool ok, bytes memory ret) = manager.staticcall(abi.encodeWithSelector(0x5e76ad54, stock));
            if (!ok || ret.length != 32) revert PauseCheckFailed(stock);
            return abi.decode(ret, (bool));
        }
        if (a.pauseCheck == PauseCheck.TokenFlag) {
            (bool ok, bytes memory ret) = stock.staticcall(abi.encodeWithSelector(0xb187bd26)); // isPaused()
            if (!ok || ret.length != 32) revert PauseCheckFailed(stock);
            return abi.decode(ret, (bool));
        }
        return false;
    }

    function _checkNotPaused(address stock) private view {
        if (isTokenPaused(stock)) revert TokenPaused(stock);
    }

    // ------------------------------------------------------------------ feed

    function feedUpdateDigest(FeedUpdate calldata u) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(FEED_UPDATE_TYPEHASH, u.stock, u.multiplier, u.validAfter, u.validUntil))
        );
    }

    function _applyUpdate(FeedUpdate calldata u, bytes calldata sig) private {
        Asset memory a = _asset[u.stock];
        if (a.source != Source.Feed) revert NotAFeedAsset(u.stock);
        if (!a.enabled) revert AssetNotEnabled(u.stock);
        address signer = feedSigner;
        if (signer == address(0)) revert InvalidSigner();
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(feedUpdateDigest(u), sig);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert InvalidSigner();
        if (block.timestamp < u.validAfter || block.timestamp > u.validUntil) {
            revert UpdateNotValidNow(u.validAfter, u.validUntil);
        }
        if (u.multiplier == 0) revert MultiplierUnavailable(u.stock);

        FeedState storage f = feedOf[u.stock];
        uint256 old = f.multiplier;
        if (old == 0) revert FeedNotSeeded(u.stock);
        // Monotonic: an older signed update can never roll the value back. The same update
        // (equal validAfter and value) may be resubmitted by another user's swap: it only
        // refreshes the timestamp.
        if (u.validAfter < f.validAfter) revert UpdateOlderThanStored(u.validAfter, f.validAfter);
        if (u.validAfter == f.validAfter && u.multiplier != old) revert UpdateConflictsWithStored(u.validAfter);

        if (u.multiplier != old && !_withinStep(old, u.multiplier, a.maxStepBps)) {
            CorporateAction memory c = corporateActionOf[u.stock];
            if (!c.registered || c.expectedMultiplier != u.multiplier) {
                revert UpdateOutOfBounds(u.stock, old, u.multiplier);
            }
            if (block.timestamp < c.notBefore) revert CorporateActionNotReady(u.stock, c.notBefore);
            delete corporateActionOf[u.stock];
            emit CorporateActionCleared(u.stock, true);
        }

        f.multiplier = u.multiplier;
        f.validAfter = u.validAfter;
        f.updatedAt = uint64(block.timestamp);
        emit FeedUpdated(u.stock, u.multiplier, old, u.validAfter, uint64(block.timestamp));
    }

    /// @dev An increase of at most `stepBps` basis points. Decreases are never "within step".
    function _withinStep(uint256 old, uint256 proposed, uint16 stepBps) private pure returns (bool) {
        if (proposed < old) return false;
        return (proposed - old) * 10_000 <= old * stepBps;
    }
}
