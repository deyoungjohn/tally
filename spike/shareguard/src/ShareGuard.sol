// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
}

interface IUiMultiplier {
    function uiMultiplier() external view returns (uint256);
}

interface IMultiplier {
    function multiplier() external view returns (uint256);
}

/// @title ShareGuard (spike, unaudited)
/// @dev DO NOT DEPLOY. Known issue: swapForShares calls any caller-supplied `router` with any
///      `data`, so an attacker could pass router = a token and data = transferFrom(victim, ...)
///      and drain anyone who approved this contract. ShareGuard v1 must allow-list routers and
///      approve targets (TALLY_BLUEPRINT.md §10, fork test G).
/// @notice Slippage protection measured in shares of the underlying stock, not in tokens.
///         One token of a tokenized stock is `multiplier` shares, and the multiplier differs per
///         issuer (Ondo NFLX = 10.0, bStock NFLX = 1.0). ShareGuard converts what the trader
///         received into shares and reverts below `minShares`.
///
///         Two ways to use it, both exercised by the fork test:
///         - swapForShares: ShareGuard is the trader. It pulls tokenIn, runs the aggregator
///           calldata (built with userWalletAddress = this contract), checks shares, forwards.
///         - assertMinShares: the user trades from their own wallet and calls this afterwards in
///           the same transaction (an EIP-7702 batch), so a shortfall reverts the whole batch.
contract ShareGuard {
    enum Source {
        None,
        UiMultiplier, // bStock: token.uiMultiplier()
        Multiplier, // xStocks: token.multiplier()
        Feed // Ondo: no on-chain multiplier; owner-set value (a bounded signed feed in production)
    }

    struct Asset {
        Source source;
        uint256 feed; // shares per token, 1e18, only for Source.Feed
    }

    address public owner;
    mapping(address => Asset) public assets;

    event AssetSet(address indexed stock, Source source, uint256 feed);
    event Guarded(address indexed recipient, address indexed stock, uint256 tokensOut, uint256 shares);

    error NotOwner();
    error UnknownAsset(address stock);
    error InsufficientShares(uint256 shares, uint256 minShares);
    error NoOutput();
    error RouterCallFailed(bytes reason);
    error TokenCallFailed(address token, bytes4 selector);

    constructor(address owner_) {
        owner = owner_;
    }

    function setAsset(address stock, Source source, uint256 feed) external {
        if (msg.sender != owner) revert NotOwner();
        assets[stock] = Asset(source, feed);
        emit AssetSet(stock, source, feed);
    }

    function sharesPerToken(address stock) public view returns (uint256) {
        Asset memory a = assets[stock];
        if (a.source == Source.UiMultiplier) return IUiMultiplier(stock).uiMultiplier();
        if (a.source == Source.Multiplier) return IMultiplier(stock).multiplier();
        if (a.source == Source.Feed) return a.feed;
        revert UnknownAsset(stock);
    }

    function toShares(address stock, uint256 tokens) public view returns (uint256) {
        return tokens * sharesPerToken(stock) / 1e18;
    }

    /// @notice Trade through ShareGuard. `data` must be swap calldata built for this contract.
    function swapForShares(
        address tokenIn,
        uint256 amountIn,
        address approveTarget,
        address router,
        bytes calldata data,
        address stock,
        uint256 minShares,
        address recipient
    ) external returns (uint256 shares) {
        uint256 inBefore = IERC20Min(tokenIn).balanceOf(address(this));
        uint256 stockBefore = IERC20Min(stock).balanceOf(address(this));
        _pullAndRoute(tokenIn, amountIn, approveTarget, router, data);

        uint256 out = IERC20Min(stock).balanceOf(address(this)) - stockBefore;
        if (out == 0) revert NoOutput();
        shares = toShares(stock, out);
        if (shares < minShares) revert InsufficientShares(shares, minShares);

        _call(stock, abi.encodeWithSelector(0xa9059cbb, recipient, out)); // transfer
        _refund(tokenIn, inBefore);
        emit Guarded(recipient, stock, out, shares);
    }

    function _pullAndRoute(address tokenIn, uint256 amountIn, address approveTarget, address router, bytes calldata data)
        private
    {
        _call(tokenIn, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amountIn)); // transferFrom
        _call(tokenIn, abi.encodeWithSelector(0x095ea7b3, approveTarget, amountIn)); // approve
        (bool ok, bytes memory ret) = router.call(data);
        if (!ok) revert RouterCallFailed(ret);
        _call(tokenIn, abi.encodeWithSelector(0x095ea7b3, approveTarget, 0)); // clear allowance
    }

    function _refund(address tokenIn, uint256 inBefore) private {
        uint256 leftover = IERC20Min(tokenIn).balanceOf(address(this)) - inBefore;
        if (leftover > 0) _call(tokenIn, abi.encodeWithSelector(0xa9059cbb, msg.sender, leftover));
    }

    /// @notice Post-trade check for a batch: reverts unless `account` gained >= minShares.
    function assertMinShares(address account, address stock, uint256 balanceBefore, uint256 minShares)
        external
        view
        returns (uint256 shares)
    {
        uint256 bal = IERC20Min(stock).balanceOf(account);
        if (bal <= balanceBefore) revert NoOutput();
        shares = toShares(stock, bal - balanceBefore);
        if (shares < minShares) revert InsufficientShares(shares, minShares);
    }

    /// @dev Tolerates tokens that return nothing (old-style ERC-20) as well as bool.
    function _call(address token, bytes memory payload) private {
        (bool ok, bytes memory ret) = token.call(payload);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) {
            revert TokenCallFailed(token, bytes4(payload));
        }
    }
}
