// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {BatchExecutor} from "../src/BatchExecutor.sol";
import {SpikeVulnerable} from "./SpikeVulnerable.sol";

interface IPauseManagerOf {
    function tokenPauseManager() external view returns (address);
}

/// Fork tests A-I: REAL Trading API swap calldata (captured by spike/capture_route.py) replayed
/// on a BSC mainnet fork against ShareGuard v1. Each test is an experiment; a failure is a
/// finding, so failures log the router's revert data.
///
///   CAPTURE=captures/NVDAB.json BSC_RPC=<archive url> forge test --match-contract Fork -vv
///
/// Without CAPTURE set every test is skipped (so `forge test` stays offline). The fork is pinned
/// to the capture's block so an old capture replays (a quote goes stale within minutes on the
/// live chain, F5); set FORK_LATEST=1 to fork the chain tip for a capture made seconds ago.
contract ShareGuardForkTest is Test {
    using stdJson for string;

    uint256 constant TEST_PK = 0xA11CE;
    address constant TEST_USER = 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7; // vm.addr(TEST_PK)
    address constant GUARD = 0xcb634955B8A7DF7B106f7AB47C9759B26206b777; // capture_route.GUARD_ADDR
    address constant BSTOCK_PAUSE_MANAGER = 0x9fc74Be63f3589485B2423984a7a0557e0CF700a;
    uint256 constant FEED_SIGNER_PK = 0xFEED5;
    bytes4 constant IS_TOKEN_PAUSED = 0x5e76ad54;

    struct Leg {
        bool replayable;
        address router;
        address approveTarget;
        bytes data;
        uint256 value;
        uint256 minReceive;
        uint256 quoted;
        uint256 apiGas;
        string route;
    }

    string json;
    bool haveCapture;
    bool isFeed;
    string token;
    address stock;
    address usdt;
    uint256 amountIn;
    uint256 captureMultiplier;
    ShareGuard guard;
    Leg gl; // the leg built for the guard's address

    function setUp() public {
        string memory path = vm.envOr("CAPTURE", string(""));
        if (bytes(path).length == 0) return;
        json = vm.readFile(path);
        uint256 pin = vm.parseUint(json.readString(".blockAtCapture"));
        if (vm.envOr("FORK_LATEST", false)) vm.createSelectFork(vm.envString("BSC_RPC"));
        else vm.createSelectFork(vm.envString("BSC_RPC"), pin);
        haveCapture = true;
        token = json.readString(".token");
        stock = json.readAddress(".tokenAddress");
        usdt = json.readAddress(".tokenIn");
        amountIn = vm.parseUint(json.readString(".amountIn"));
        captureMultiplier = vm.parseUint(json.readString(".multiplier"));
        assertEq(vm.addr(TEST_PK), TEST_USER, "test key / capture user mismatch");
        gl = _leg(".guard");

        deployCodeTo("ShareGuard.sol:ShareGuard", abi.encode(address(this), vm.addr(FEED_SIGNER_PK)), GUARD);
        guard = ShareGuard(GUARD);
        if (gl.replayable) guard.setRouter(gl.router, true, gl.approveTarget);
        bytes32 src = keccak256(bytes(json.readString(".multiplierSource")));
        if (src == keccak256("ui")) {
            guard.setAsset(
                stock,
                ShareGuard.Asset(
                    ShareGuard.Source.UiMultiplier, true, 0, ShareGuard.PauseCheck.Manager, BSTOCK_PAUSE_MANAGER
                ),
                0
            );
        } else if (src == keccak256("multiplier")) {
            guard.setAsset(
                stock,
                ShareGuard.Asset(ShareGuard.Source.Multiplier, true, 0, ShareGuard.PauseCheck.TokenFlag, address(0)),
                0
            );
        } else {
            isFeed = true;
            guard.setAsset(
                stock,
                ShareGuard.Asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.Manager, address(0)),
                captureMultiplier
            );
        }
        console2.log("token", token, "captured", json.readString(".capturedAtUtc"));
        console2.log("fork block", block.number, "capture block", json.readString(".blockAtCapture"));
        console2.log("shares per token (1e18)", guard.sharesPerToken(stock));
    }

    function _leg(string memory key) internal view returns (Leg memory l) {
        l.replayable = keccak256(bytes(json.readString(string.concat(key, ".replayable")))) == keccak256("true");
        if (!l.replayable) return l;
        l.router = json.readAddress(string.concat(key, ".router"));
        l.approveTarget = json.readAddress(string.concat(key, ".approveTarget"));
        l.data = json.readBytes(string.concat(key, ".data"));
        l.value = vm.parseUint(json.readString(string.concat(key, ".value")));
        l.minReceive = vm.parseUint(json.readString(string.concat(key, ".minReceive")));
        l.quoted = vm.parseUint(json.readString(string.concat(key, ".toTokenAmount")));
        l.route = json.readString(string.concat(key, ".route"));
        l.apiGas = vm.parseUint(json.readString(string.concat(key, ".gas")));
    }

    function _load(string memory key) internal returns (Leg memory l) {
        vm.skip(!haveCapture);
        l = _leg(key);
        if (!l.replayable) {
            console2.log("SKIP: leg not replayable (RFQ mode or API error); see capture JSON", key);
            vm.skip(true);
        }
        console2.log("route", l.route);
        deal(usdt, TEST_USER, amountIn);
        vm.deal(TEST_USER, 1 ether); // gas money / msg.value, irrelevant on a fork
    }

    function _bal(address who) internal view returns (uint256) {
        return IERC20(stock).balanceOf(who);
    }

    function _report(uint256 tokensOut) internal view {
        uint256 shares = guard.toShares(stock, tokensOut);
        console2.log("tokens out", tokensOut);
        console2.log("shares out", shares);
        if (shares > 0) console2.log("USDT per share (1e18)", amountIn * 1e18 / shares);
    }

    /// Turns revert data into a readable finding.
    function _explain(bytes memory reason) internal pure {
        bytes4 sel;
        assembly {
            sel := and(mload(add(reason, 32)), not(sub(shl(224, 1), 1)))
        }
        if (sel == ShareGuard.NoOutput.selector) {
            console2.log("FINDING: route ran but no stock reached the guard (output sent elsewhere?)");
        } else if (sel == ShareGuard.RouterCallFailed.selector) {
            console2.log("FINDING: aggregator router reverted; inner revert data follows");
        } else if (sel == ShareGuard.InsufficientShares.selector) {
            console2.log("FINDING: filled, but below the share-denominated minimum");
        } else if (sel == ShareGuard.TokenPaused.selector || sel == ShareGuard.PauseCheckFailed.selector) {
            console2.log("FINDING: the token's pause check blocked or failed");
        } else if (sel == BatchExecutor.CallFailed.selector) {
            console2.log("FINDING: a batch call failed (index 1 = swap, 2 = share check)");
        }
        console2.logBytes(reason);
    }

    function _swapArgs(uint256 minShares) internal view returns (bytes memory) {
        return abi.encodeCall(
            ShareGuard.swapForShares,
            (usdt, amountIn, stock, minShares, gl.router, gl.data, TEST_USER, block.timestamp + 1 hours)
        );
    }

    function _approveGuard() internal {
        vm.prank(TEST_USER);
        IERC20(usdt).approve(GUARD, amountIn);
    }

    /// The pause manager ShareGuard consults for `stock` (fixed for bStock, read from the token for Ondo).
    function _pauseManager() internal view returns (address) {
        return guard.assetOf(stock).pauseManager != address(0)
            ? guard.assetOf(stock).pauseManager
            : IPauseManagerOf(stock).tokenPauseManager();
    }

    // ---------------------------------------------------------------------------------- A

    /// A. Baseline: the user's own wallet replays the API transaction unchanged.
    function test_A_replayAsPlainWallet() public {
        Leg memory l = _load(".eoa");
        uint256 before = _bal(TEST_USER);
        vm.startPrank(TEST_USER, TEST_USER);
        IERC20(usdt).approve(l.approveTarget, amountIn);
        (bool ok, bytes memory ret) = l.router.call{value: l.value}(l.data);
        vm.stopPrank();
        if (!ok) {
            console2.log("FINDING: the API transaction reverted even for the wallet it was built for:");
            console2.logBytes(ret);
        }
        assertTrue(ok, "API calldata did not replay for the wallet it was built for");
        uint256 got = _bal(TEST_USER) - before;
        _report(got);
        assertGe(got, l.minReceive, "received less than the API's own minReceive");
    }

    // ---------------------------------------------------------------------------------- B

    /// B. ShareGuard v1 as the trader, with calldata the API built for the guard's address, through
    ///    the allow-listed router, with the real issuer pause check in the path.
    function test_B_guardWrapped() public {
        Leg memory l = _load(".guard");
        uint256 minShares = guard.toShares(stock, l.minReceive);
        uint256 before = _bal(TEST_USER);
        _approveGuard();
        vm.expectEmit(true, true, true, false, GUARD);
        emit ShareGuard.Guarded(TEST_USER, TEST_USER, stock, usdt, 0, 0, 0, 0, address(0));
        vm.prank(TEST_USER, TEST_USER);
        (bool ok, bytes memory ret) = GUARD.call(_swapArgs(minShares));
        if (!ok) _explain(ret);
        assertTrue(ok, "guarded swap reverted");
        _report(_bal(TEST_USER) - before);
        assertEq(_bal(GUARD), 0, "guard kept stock");
        assertEq(IERC20(usdt).balanceOf(GUARD), 0, "guard kept USDT");
        assertEq(IERC20(usdt).allowance(GUARD, l.approveTarget), 0, "approval not reset");
        assertEq(IERC20(usdt).balanceOf(TEST_USER) + (amountIn - IERC20(usdt).balanceOf(TEST_USER)), amountIn);
    }

    /// B2 (Ondo only). The same buy with a signed multiplier update applied first: the EIP-712
    ///    path on real state. The update raises the multiplier by 0.1%, inside the 300 bps bound.
    function test_B2_guardWrappedWithSignedFeed() public {
        Leg memory l = _load(".guard");
        if (!isFeed) {
            console2.log("SKIP: not a Feed (Ondo) asset");
            vm.skip(true);
        }
        uint256 newM = captureMultiplier * 1001 / 1000;
        ShareGuard.FeedUpdate memory u =
            ShareGuard.FeedUpdate(stock, newM, uint64(block.timestamp - 5), uint64(block.timestamp + 1 hours));
        _approveGuard();
        uint256 shares = _feedSwap(l, guard.toShares(stock, l.minReceive), u, _sign(FEED_SIGNER_PK, u));
        (uint256 stored,,) = guard.feedOf(stock);
        assertEq(stored, newM, "feed value stored");
        assertEq(shares, _bal(TEST_USER) * newM / 1e18, "shares priced at the updated multiplier");
    }

    // ---------------------------------------------------------------------------------- C

    /// C. ShareGuard refuses a fill below a share-denominated minimum (asks for 2x the quote).
    function test_C_guardRejectsShortfall() public {
        Leg memory l = _load(".guard");
        uint256 minShares = guard.toShares(stock, l.quoted) * 2;
        _approveGuard();
        vm.prank(TEST_USER, TEST_USER);
        vm.expectPartialRevert(ShareGuard.InsufficientShares.selector);
        (bool ok,) = GUARD.call(_swapArgs(minShares));
        ok;
        assertEq(IERC20(usdt).balanceOf(TEST_USER), amountIn, "USDT untouched after revert");
    }

    // ------------------------------------------------------------------------------- D, E

    function _batch(Leg memory l, uint256 before, uint256 minShares)
        internal
        view
        returns (BatchExecutor.Call[] memory calls)
    {
        calls = new BatchExecutor.Call[](3);
        calls[0] = BatchExecutor.Call(usdt, 0, abi.encodeCall(IERC20.approve, (l.approveTarget, amountIn)));
        calls[1] = BatchExecutor.Call(l.router, l.value, l.data);
        calls[2] = BatchExecutor.Call(
            GUARD, 0, abi.encodeCall(ShareGuard.assertMinShares, (TEST_USER, stock, before, minShares))
        );
    }

    /// D. Fallback design: the user's wallet runs [approve, API swap, share check] as one
    ///    EIP-7702 batch. The API calldata is used unchanged, so RFQ/taker binding is preserved.
    function test_D_7702BatchSwapThenAssert() public {
        Leg memory l = _load(".eoa");
        uint256 before = _bal(TEST_USER);
        BatchExecutor.Call[] memory calls = _batch(l, before, guard.toShares(stock, l.minReceive));
        BatchExecutor impl = new BatchExecutor();
        vm.signAndAttachDelegation(address(impl), TEST_PK);
        vm.prank(TEST_USER, TEST_USER);
        try BatchExecutor(TEST_USER).execute(calls) {}
        catch (bytes memory reason) {
            _explain(reason);
            fail();
        }
        _report(_bal(TEST_USER) - before);
    }

    /// E. Same batch with an impossible minimum: the whole batch, swap included, must revert.
    function test_E_7702BatchRevertsAtomically() public {
        Leg memory l = _load(".eoa");
        uint256 before = _bal(TEST_USER);
        BatchExecutor.Call[] memory calls = _batch(l, before, guard.toShares(stock, l.quoted) * 2);
        BatchExecutor impl = new BatchExecutor();
        vm.signAndAttachDelegation(address(impl), TEST_PK);
        vm.prank(TEST_USER, TEST_USER);
        try BatchExecutor(TEST_USER).execute(calls) {
            fail(); // the impossible minimum should have reverted the batch
        } catch (bytes memory reason) {
            bytes4 sel;
            uint256 index;
            assembly {
                sel := and(mload(add(reason, 32)), not(sub(shl(224, 1), 1)))
                index := mload(add(reason, 36))
            }
            assertEq(sel, BatchExecutor.CallFailed.selector, "unexpected revert");
            assertEq(index, 2, "batch failed at the swap, not at the share check");
        }
        assertEq(IERC20(usdt).balanceOf(TEST_USER), amountIn, "USDT must be untouched after revert");
    }

    // ---------------------------------------------------------------------------------- F

    /// @dev Gas actually needed by a call, like eth_estimateGas: the smallest limit at which it
    ///      succeeds (binary search; each attempt runs on a fresh snapshot of the same state).
    function _minGas(bytes memory callData, address from) internal returns (uint256 needed, uint256 used) {
        uint256 snap = vm.snapshotState();
        vm.prank(from, from);
        uint256 g0 = gasleft();
        (bool ok,) = GUARD.call(callData);
        used = g0 - gasleft();
        require(ok, "route fails even without a gas cap; see tests A and B");
        vm.revertToState(snap);
        uint256 lo = used / 2;
        uint256 hi = used * 2;
        while (hi - lo > 1_000) {
            uint256 mid = (lo + hi) / 2;
            snap = vm.snapshotState();
            vm.prank(from, from);
            (bool success,) = GUARD.call{gas: mid}(callData);
            vm.revertToState(snap);
            if (success) hi = mid;
            else lo = mid;
        }
        needed = hi;
    }

    /// F. The route fits the gas limit WE send: limit = ceil(estimate x 1.25) (blueprint V10, §7.6),
    ///    not the API's 450000. On 2026-10-01 a live NVDAon swap sent with the API's gas reverted
    ///    (FailedInnerCall) and needed ~1.03M, while Forge, which doesn't cap gas, passed A-E.
    function test_F_fitsOurGasLimitNotTheApis() public {
        Leg memory l = _load(".guard");
        bytes memory cd = _swapArgs(guard.toShares(stock, l.minReceive));
        _approveGuard();
        uint256 intrinsic = 21_000 + 16 * cd.length; // upper bound: every calldata byte non-zero
        (uint256 needed, uint256 used) = _minGas(cd, TEST_USER);
        uint256 estimate = needed + intrinsic;
        uint256 limit = (estimate * 125 + 99) / 100; // ceil(estimate x 1.25)
        console2.log("API gas (the placeholder)", l.apiGas);
        console2.log("gas used by the guarded call", used);
        console2.log("estimate (min gas that succeeds + intrinsic)", estimate);
        console2.log("limit we send (estimate x 1.25)", limit);
        if (estimate > l.apiGas) {
            console2.log("FINDING: the API's gas limit is too low for this route; sending it would revert");
        }
        // 1. it succeeds at exactly the limit we would send
        vm.prank(TEST_USER, TEST_USER);
        (bool ok, bytes memory ret) = GUARD.call{gas: limit - intrinsic}(cd);
        if (!ok) _explain(ret);
        assertTrue(ok, "route does not fit the limit we send");
        // 2. and a limit short of the estimate does fail, so the search measured something real
        _approveGuard();
        vm.prank(TEST_USER, TEST_USER);
        (bool tooLow,) = GUARD.call{gas: needed * 9 / 10}(cd);
        assertFalse(tooLow, "the call succeeded below its own estimate: the estimate is not tight");
    }

    // ---------------------------------------------------------------------------------- G

    /// G. The arbitrary-call attack (blueprint §10, spike hole): router = USDT, data =
    ///    transferFrom(victim, attacker, amount), against a user who approved the guard.
    ///    Shown first against the spike's logic (it drains the victim on real USDT), then
    ///    against v1, where it must revert and the victim must keep every token.
    function test_G_arbitraryCallAttackReverts() public {
        Leg memory l = _load(".guard");
        address victim = makeAddr("victim");
        address attacker = makeAddr("attacker");
        uint256 loot = 1000e18;
        deal(usdt, victim, loot);
        deal(usdt, attacker, amountIn);
        deal(stock, attacker, 1e12); // a little stock, needed by the spike variant to pass its output check
        bytes memory evil = abi.encodeCall(IERC20.transferFrom, (victim, attacker, loot));

        // --- the hole in the spike design. The attack as the blueprint words it (tokenIn = USDT)
        //     is stopped by the spike's own "no output" check, because the stock balance does not move;
        //     the working exploit sets tokenIn = the stock so the pulled stock counts as output.
        SpikeVulnerable spike = new SpikeVulnerable();
        spike.setMultiplier(stock, 1e18);
        vm.prank(victim);
        IERC20(usdt).approve(address(spike), type(uint256).max);
        vm.startPrank(attacker, attacker);
        IERC20(usdt).approve(address(spike), amountIn);
        vm.expectRevert(bytes("no output"));
        spike.swapForShares(usdt, 1e6, attacker, usdt, evil, stock, 0, attacker);
        vm.stopPrank();
        assertEq(IERC20(usdt).balanceOf(victim), loot, "the literal attack is caught by the spike's output check");
        vm.startPrank(attacker, attacker);
        IERC20(stock).approve(address(spike), 1e12);
        spike.swapForShares(stock, 1e12, attacker, usdt, evil, stock, 0, attacker);
        vm.stopPrank();
        assertEq(IERC20(usdt).balanceOf(victim), 0, "the spike design is drained (this is the bug)");
        assertEq(IERC20(usdt).balanceOf(attacker), amountIn + loot);

        // --- the same victim approval and attack against v1
        deal(usdt, victim, loot);
        deal(usdt, attacker, amountIn);
        vm.prank(victim);
        IERC20(usdt).approve(GUARD, type(uint256).max);
        vm.startPrank(attacker, attacker);
        IERC20(usdt).approve(GUARD, amountIn);
        IERC20(stock).approve(GUARD, 1e12);
        uint256 dl = block.timestamp + 1 hours;
        // (1) the attack as written in the blueprint
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, usdt));
        guard.swapForShares(usdt, amountIn, stock, 1, usdt, evil, attacker, dl);
        // (2) the variant that beat the spike's output check: tokenIn = the stock
        vm.expectRevert(ShareGuard.SameToken.selector);
        guard.swapForShares(stock, 1e12, stock, 1, usdt, evil, attacker, dl);
        // (3) the stock itself, and an arbitrary contract, as the router
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, stock));
        guard.swapForShares(usdt, amountIn, stock, 1, stock, evil, attacker, dl);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, victim));
        guard.swapForShares(usdt, amountIn, stock, 1, victim, evil, attacker, dl);
        // (4) the real, allow-listed router given the attack calldata: it is not a token, so
        //     nothing is transferred from the victim whatever it does with the data
        (bool ok,) = address(guard)
            .call(abi.encodeCall(ShareGuard.swapForShares, (usdt, amountIn, stock, 1, l.router, evil, attacker, dl)));
        assertFalse(ok, "the router cannot be made to run a token call");
        vm.stopPrank();

        assertEq(IERC20(usdt).balanceOf(victim), loot, "victim untouched");
        assertEq(IERC20(usdt).balanceOf(attacker), amountIn, "attacker gained nothing");
        assertEq(IERC20(usdt).balanceOf(GUARD), 0);
    }

    // ---------------------------------------------------------------------------------- H

    /// H. A token the issuer has paused reverts before any funds move. The pause manager's answer
    ///    is mocked (we cannot pause a real issuer's token): the manager is bStock's fixed one or,
    ///    for Ondo, the one the token itself names.
    function test_H_pausedTokenReverts() public {
        Leg memory l = _load(".guard");
        address manager = _pauseManager();
        console2.log("pause manager", manager);
        assertFalse(guard.isTokenPaused(stock), "the real manager reports the token unpaused");

        vm.mockCall(manager, abi.encodeWithSelector(IS_TOKEN_PAUSED, stock), abi.encode(true));
        assertTrue(guard.isTokenPaused(stock));
        _approveGuard();
        vm.prank(TEST_USER, TEST_USER);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.TokenPaused.selector, stock));
        guard.swapForShares(usdt, amountIn, stock, 1, l.router, l.data, TEST_USER, block.timestamp + 1 hours);
        assertEq(IERC20(usdt).balanceOf(TEST_USER), amountIn, "nothing spent");

        // a manager that cannot answer fails closed instead of letting the trade through
        vm.mockCallRevert(manager, abi.encodeWithSelector(IS_TOKEN_PAUSED, stock), "boom");
        vm.prank(TEST_USER, TEST_USER);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.PauseCheckFailed.selector, stock));
        guard.swapForShares(usdt, amountIn, stock, 1, l.router, l.data, TEST_USER, block.timestamp + 1 hours);

        // unpaused again: the same trade goes through
        vm.clearMockedCalls();
        uint256 minShares = guard.toShares(stock, l.minReceive); // an external call: compute before the prank
        vm.prank(TEST_USER, TEST_USER);
        guard.swapForShares(usdt, amountIn, stock, minShares, l.router, l.data, TEST_USER, block.timestamp + 1 hours);
        assertGt(_bal(TEST_USER), 0);
    }

    // ---------------------------------------------------------------------------------- I

    /// I. A stale or out-of-bounds Ondo feed reverts. Needs a Feed asset (the NVDAon capture).
    function test_I_staleOrOutOfBoundsFeedReverts() public {
        Leg memory l = _load(".guard");
        if (!isFeed) {
            console2.log("SKIP: not a Feed (Ondo) asset");
            vm.skip(true);
        }
        uint256 minShares = guard.toShares(stock, l.minReceive);
        uint64 nowTs = uint64(block.timestamp);
        _approveGuard();

        // out of bounds: +5% and -5% against a 300 bps bound, correctly signed
        _expectFeedRevert(captureMultiplier * 105 / 100, nowTs - 5, l, minShares, ShareGuard.UpdateOutOfBounds.selector);
        _expectFeedRevert(captureMultiplier * 95 / 100, nowTs - 5, l, minShares, ShareGuard.UpdateOutOfBounds.selector);
        // an expired signature (window closed an hour ago)
        {
            ShareGuard.FeedUpdate memory u =
                ShareGuard.FeedUpdate(stock, captureMultiplier, nowTs - 2 hours, nowTs - 1 hours);
            bytes memory sig = _sign(FEED_SIGNER_PK, u);
            vm.expectRevert(
                abi.encodeWithSelector(ShareGuard.UpdateNotValidNow.selector, nowTs - 2 hours, nowTs - 1 hours)
            );
            _feedSwap(l, minShares, u, sig);
        }
        // a signature from anyone but the feed signer
        {
            ShareGuard.FeedUpdate memory u = ShareGuard.FeedUpdate(stock, captureMultiplier, nowTs - 5, nowTs + 1 hours);
            bytes memory sig = _sign(0xBAD1, u);
            vm.expectRevert(ShareGuard.InvalidSigner.selector);
            _feedSwap(l, minShares, u, sig);
        }
        // stale: past maxAge (3 days) with no update supplied, then with the update unchanged
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(TEST_USER, TEST_USER);
        vm.expectPartialRevert(ShareGuard.FeedStale.selector);
        guard.swapForShares(usdt, amountIn, stock, minShares, l.router, l.data, TEST_USER, block.timestamp + 1 hours);
        assertEq(IERC20(usdt).balanceOf(TEST_USER), amountIn, "nothing spent on any rejected feed");
    }

    function _expectFeedRevert(uint256 m, uint64 validAfter, Leg memory l, uint256 minShares, bytes4 sel) internal {
        ShareGuard.FeedUpdate memory u = ShareGuard.FeedUpdate(stock, m, validAfter, uint64(block.timestamp + 1 hours));
        bytes memory sig = _sign(FEED_SIGNER_PK, u);
        vm.expectPartialRevert(sel);
        _feedSwap(l, minShares, u, sig);
    }

    function _sign(uint256 pk, ShareGuard.FeedUpdate memory u) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, guard.feedUpdateDigest(u));
        return abi.encodePacked(r, s, v);
    }

    function _feedSwap(Leg memory l, uint256 minShares, ShareGuard.FeedUpdate memory u, bytes memory sig)
        internal
        returns (uint256)
    {
        vm.prank(TEST_USER, TEST_USER);
        return guard.swapForSharesWithFeed(
            usdt, amountIn, stock, minShares, l.router, l.data, TEST_USER, block.timestamp + 1 hours, u, sig
        );
    }
}
