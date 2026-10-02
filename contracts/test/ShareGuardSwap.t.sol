// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GuardBase} from "./Base.t.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {BatchExecutor} from "../src/BatchExecutor.sol";
import {MockToken, MockRouter, MockPauseManager, ReentrantRouter} from "./Mocks.sol";

/// Offline tests (no RPC, no API key) of the swap path. The first nine mirror the spike's.
contract ShareGuardSwapTest is GuardBase {
    // --- ported from the spike -------------------------------------------------------------

    function test_convertsTokensToSharesWithOnchainMultiplier() public {
        bstock.setUiMultiplier(1.000778e18);
        uint256 shares = _buy(bstock, 10e18, 0.04e18, 0.04e18);
        assertEq(bstock.balanceOf(user), 0.04e18, "tokens forwarded to recipient");
        assertEq(shares, 0.04e18 * 1.000778e18 / 1e18, "shares = tokens x multiplier");
        assertEq(bstock.balanceOf(address(guard)), 0, "guard keeps nothing");
    }

    function test_revertsBelowMinShares() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InsufficientShares.selector, 0.04e18, 0.05e18));
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 0.05e18, address(router), _data(bstock, 10e18, 0.04e18, address(guard)), user, block.timestamp
        );
        vm.stopPrank();
        assertEq(usdt.balanceOf(user), 100e18, "nothing spent on revert");
    }

    /// The NFLX case: Ondo token = 10 shares. A token-denominated minimum of 1 would accept
    /// 0.1 token (= 1 share) as if it were 1 share; a share-denominated minimum does not.
    function test_splitAdjustedTokenUsesShares() public {
        // an Ondo-style 10x asset: seed the feed at 10.0
        MockToken nflx = new MockToken();
        nflx.setPauseManager(address(pm));
        guard.setAsset(
            address(nflx),
            ShareGuard.Asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.Manager, address(0)),
            10e18
        );
        assertEq(_buy(nflx, 10e18, 0.1e18, 1e18), 1e18, "0.1 token x 10 = 1 share");
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectPartialRevert(ShareGuard.InsufficientShares.selector);
        guard.swapForShares(
            address(usdt), 10e18, address(nflx), 2e18, address(router), _data(nflx, 10e18, 0.1e18, address(guard)), user, block.timestamp
        );
        vm.stopPrank();
    }

    function test_revertsWhenRouteDeliversElsewhere() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(ShareGuard.NoOutput.selector);
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), _data(bstock, 10e18, 1e18, address(0xBEEF)), user, block.timestamp
        );
        vm.stopPrank();
    }

    function test_refundsUnspentInputAndClearsAllowance() public {
        _buy(bstock, 7e18, 1e18, 1);
        assertEq(usdt.balanceOf(user), 93e18, "3 unspent USDT refunded");
        assertEq(usdt.balanceOf(address(guard)), 0, "guard keeps no USDT");
        assertEq(usdt.allowance(address(guard), address(router)), 0, "allowance cleared");
    }

    function test_unknownAssetReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.AssetNotEnabled.selector, address(usdt)));
        guard.sharesPerToken(address(usdt));
    }

    // --- events ----------------------------------------------------------------------------

    function test_emitsGuarded() public {
        bstock.setUiMultiplier(1.5e18);
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        bytes memory d = _data(bstock, 10e18, 2e18, address(guard));
        vm.expectEmit(true, true, true, true, address(guard));
        emit ShareGuard.Guarded(user, user, address(bstock), address(usdt), 10e18, 2e18, 3e18, 1.5e18, address(router));
        guard.swapForShares(address(usdt), 10e18, address(bstock), 3e18, address(router), d, user, block.timestamp);
        vm.stopPrank();
    }

    function test_recipientCanBeAnotherAddress() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), _data(bstock, 10e18, 1e18, address(guard)), stranger, block.timestamp
        );
        vm.stopPrank();
        assertEq(bstock.balanceOf(stranger), 1e18);
        assertEq(bstock.balanceOf(user), 0);
    }

    // --- input checks ----------------------------------------------------------------------

    function test_deadlineExpired() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        bytes memory d = _data(bstock, 10e18, 1e18, address(guard));
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.Expired.selector, block.timestamp - 1));
        guard.swapForShares(address(usdt), 10e18, address(bstock), 1, address(router), d, user, block.timestamp - 1);
        // exactly at the deadline is still fine
        guard.swapForShares(address(usdt), 10e18, address(bstock), 1, address(router), d, user, block.timestamp);
        vm.stopPrank();
    }

    function test_zeroAmountMinSharesRecipientReverts() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        bytes memory d = _data(bstock, 10e18, 1e18, address(guard));
        vm.expectRevert(ShareGuard.ZeroAmount.selector);
        guard.swapForShares(address(usdt), 0, address(bstock), 1, address(router), d, user, block.timestamp);
        vm.expectRevert(ShareGuard.ZeroMinShares.selector);
        guard.swapForShares(address(usdt), 10e18, address(bstock), 0, address(router), d, user, block.timestamp);
        vm.expectRevert(ShareGuard.ZeroAddress.selector);
        guard.swapForShares(address(usdt), 10e18, address(bstock), 1, address(router), d, address(0), block.timestamp);
        vm.expectRevert(ShareGuard.SameToken.selector);
        guard.swapForShares(address(bstock), 10e18, address(bstock), 1, address(router), d, user, block.timestamp);
        vm.stopPrank();
    }

    function test_routerRevertIsWrapped() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectPartialRevert(ShareGuard.RouterCallFailed.selector);
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), abi.encodeCall(MockRouter.fail, ()), user, block.timestamp
        );
        vm.stopPrank();
        assertEq(usdt.balanceOf(user), 100e18);
    }

    function test_needsAllowanceFromUser() public {
        vm.prank(user, user);
        vm.expectRevert(); // MockToken underflow: no allowance
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), _data(bstock, 10e18, 1e18, address(guard)), user, block.timestamp
        );
    }

    function test_disabledAssetReverts() public {
        guard.setAsset(
            address(bstock),
            ShareGuard.Asset(ShareGuard.Source.UiMultiplier, false, 0, ShareGuard.PauseCheck.Manager, address(pm)),
            0
        );
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.AssetNotEnabled.selector, address(bstock)));
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), _data(bstock, 10e18, 1e18, address(guard)), user, block.timestamp
        );
        vm.stopPrank();
    }

    function test_multiplierSourceFailureReverts() public {
        // an asset whose uiMultiplier() returns 0 must not be treated as "0 shares, passes min 0"
        bstock.setUiMultiplier(0);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.MultiplierUnavailable.selector, address(bstock)));
        guard.sharesPerToken(address(bstock));
        // a Multiplier-source asset pointing at a token without multiplier() fails closed too
        guard.setAsset(
            address(usdt),
            ShareGuard.Asset(ShareGuard.Source.UiMultiplier, true, 0, ShareGuard.PauseCheck.None, address(0)),
            0
        );
        MockToken bare = new MockToken();
        guard.setAsset(
            address(bare),
            ShareGuard.Asset(ShareGuard.Source.Multiplier, true, 0, ShareGuard.PauseCheck.None, address(0)),
            0
        );
        bare.setMultiplier(2e18);
        assertEq(guard.sharesPerToken(address(bare)), 2e18);
    }

    // --- the arbitrary-call fix (blueprint §10, fork test G's offline twin) ----------------

    /// The spike's hole: router = the payment token, data = transferFrom(victim, attacker, ...).
    function test_attack_routerIsTheTokenReverts() public {
        address victim = address(0x71C71);
        usdt.mint(victim, 1000e18);
        vm.prank(victim);
        usdt.approve(address(guard), type(uint256).max); // a user who approved the guard
        bytes memory evil = abi.encodeCall(MockToken.transferFrom, (victim, stranger, 1000e18));
        usdt.mint(stranger, 1e18);
        vm.startPrank(stranger, stranger);
        usdt.approve(address(guard), 1e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, address(usdt)));
        guard.swapForShares(address(usdt), 1e18, address(bstock), 1, address(usdt), evil, stranger, block.timestamp);
        vm.stopPrank();
        assertEq(usdt.balanceOf(victim), 1000e18, "victim untouched");
    }

    function test_attack_routerIsTheStockOrTheGuardReverts() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, address(bstock)));
        guard.swapForShares(address(usdt), 10e18, address(bstock), 1, address(bstock), "", user, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, address(guard)));
        guard.swapForShares(address(usdt), 10e18, address(bstock), 1, address(guard), "", user, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, address(0xDEAD)));
        guard.swapForShares(address(usdt), 10e18, address(bstock), 1, address(0xDEAD), "", user, block.timestamp);
        vm.stopPrank();
    }

    function test_removedRouterIsRejected() public {
        guard.setRouter(address(router), false, address(0));
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, address(router)));
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), _data(bstock, 10e18, 1e18, address(guard)), user, block.timestamp
        );
        vm.stopPrank();
    }

    /// Even an allow-listed router cannot be pointed at the guard's own entry points.
    function test_reentrancyBlocked() public {
        ReentrantRouter bad = new ReentrantRouter();
        guard.setRouter(address(bad), true, address(bad));
        bytes memory inner = abi.encodeCall(
            ShareGuard.swapForShares,
            (address(usdt), 1, address(bstock), 1, address(bad), "", user, block.timestamp)
        );
        bad.arm(address(guard), inner);
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectPartialRevert(ShareGuard.RouterCallFailed.selector);
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(bad),
            abi.encodeCall(ReentrantRouter.swap, (usdt, 10e18, bstock, 1e18, address(guard))), user, block.timestamp
        );
        vm.stopPrank();
    }

    // --- pause -----------------------------------------------------------------------------

    function test_globalPauseBlocksNewSwaps() public {
        guard.pause();
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(); // Pausable.EnforcedPause
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), _data(bstock, 10e18, 1e18, address(guard)), user, block.timestamp
        );
        vm.stopPrank();
        guard.unpause();
        assertEq(_buy(bstock, 10e18, 1e18, 1), 1e18);
    }

    function test_tokenPausedByManagerReverts() public {
        pm.setPaused(address(bstock), true);
        assertTrue(guard.isTokenPaused(address(bstock)));
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.TokenPaused.selector, address(bstock)));
        guard.swapForShares(
            address(usdt), 10e18, address(bstock), 1, address(router), _data(bstock, 10e18, 1e18, address(guard)), user, block.timestamp
        );
        vm.stopPrank();
        assertEq(usdt.balanceOf(user), 100e18);
    }

    function test_ondoPauseManagerIsReadFromTheToken() public {
        // the Ondo asset has pauseManager = 0: the guard asks the token who its manager is
        pm.setPaused(address(ondo), true);
        assertTrue(guard.isTokenPaused(address(ondo)));
        // a rotated manager is followed without an owner transaction
        MockPauseManager other = new MockPauseManager();
        ondo.setPauseManager(address(other));
        assertFalse(guard.isTokenPaused(address(ondo)));
    }

    function test_pauseCheckFailsClosed() public {
        pm.setReverts(true);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.PauseCheckFailed.selector, address(bstock)));
        guard.isTokenPaused(address(bstock));
        pm.setReverts(false);
        ondo.setPauseManager(address(0)); // token reports no manager
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.PauseCheckFailed.selector, address(ondo)));
        guard.isTokenPaused(address(ondo));
    }

    function test_tokenFlagPause() public {
        MockToken xs = new MockToken();
        guard.setAsset(
            address(xs),
            ShareGuard.Asset(ShareGuard.Source.Multiplier, true, 0, ShareGuard.PauseCheck.TokenFlag, address(0)),
            0
        );
        assertFalse(guard.isTokenPaused(address(xs)));
        xs.setPaused(true);
        assertTrue(guard.isTokenPaused(address(xs)));
    }

    // --- 7702 batch path (spike tests D and E, offline) ------------------------------------

    function _batch(uint256 minShares) internal view returns (BatchExecutor.Call[] memory calls) {
        calls = new BatchExecutor.Call[](3);
        calls[0] = BatchExecutor.Call(address(usdt), 0, abi.encodeCall(MockToken.approve, (address(router), 10e18)));
        calls[1] = BatchExecutor.Call(address(router), 0, _data(bstock, 10e18, 0.04e18, user));
        calls[2] = BatchExecutor.Call(
            address(guard), 0, abi.encodeCall(ShareGuard.assertMinShares, (user, address(bstock), 0, minShares))
        );
    }

    function test_7702BatchSwapThenAssert() public {
        _runBatch(_batch(0.04e18), false);
        assertEq(bstock.balanceOf(user), 0.04e18);
        assertEq(usdt.balanceOf(user), 90e18);
    }

    function test_7702BatchRevertsAtomicallyOnShortfall() public {
        _runBatch(_batch(0.05e18), true);
        assertEq(usdt.balanceOf(user), 100e18, "swap rolled back with the failed check");
        assertEq(bstock.balanceOf(user), 0);
    }

    function _runBatch(BatchExecutor.Call[] memory calls, bool expectRevert) internal {
        // the spike's BatchExecutor, delegated to by the user's EOA
        BatchExecutor impl = new BatchExecutor();
        vm.signAndAttachDelegation(address(impl), USER_PK);
        vm.prank(user, user);
        if (expectRevert) vm.expectRevert();
        BatchExecutor(user).execute(calls);
    }
}
