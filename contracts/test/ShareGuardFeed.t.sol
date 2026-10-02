// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GuardBase} from "./Base.t.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {MockToken} from "./Mocks.sol";

/// The Ondo multiplier feed: bounded per asset, monotonic, expiring, and unable to make a
/// decrease or a large increase without an owner-registered corporate action.
contract ShareGuardFeedTest is GuardBase {
    uint64 constant T0 = 1_800_000_000;

    function _now() internal view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _ok(uint256 m, uint64 validAfter) internal view returns (ShareGuard.FeedUpdate memory u, bytes memory sig) {
        return _update(address(ondo), m, validAfter, _now() + 1 hours);
    }

    function _stored() internal view returns (uint256 m, uint64 updatedAt, uint64 validAfter) {
        return guard.feedOf(address(ondo));
    }

    // --- happy path ------------------------------------------------------------------------

    function test_swapWithoutUpdateUsesSeed() public {
        assertEq(_buy(ondo, 10e18, 1e18, 1e18), 1e18);
    }

    function test_smallIncreaseAcceptedAndStored() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1.0058e18, T0); // +0.58% (the largest step seen, USHY)
        _approveAll();
        vm.expectEmit(true, false, false, true, address(guard));
        emit ShareGuard.FeedUpdated(address(ondo), 1.0058e18, 1e18, T0, _now());
        uint256 shares = _feedCall(u, sig, 2e18, 1);
        assertEq(shares, 2e18 * 1.0058e18 / 1e18, "the new multiplier prices the swap");
        (uint256 m, uint64 at, uint64 va) = _stored();
        assertEq(m, 1.0058e18);
        assertEq(at, _now());
        assertEq(va, T0);
    }

    function test_incrementExactlyAtTheBoundIsAccepted() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1.03e18, T0); // exactly +300 bps
        _buyWithFeed(u, sig, 1e18, 1);
        (uint256 m,,) = _stored();
        assertEq(m, 1.03e18);
    }

    function test_justAboveTheBoundNeedsACorporateAction() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1.030000000000000001e18, T0);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateOutOfBounds.selector, address(ondo), 1e18, 1.030000000000000001e18), u, sig);
    }

    function test_perAssetStep() public {
        // a second asset with a tighter 50 bps bound: 1% is fine for `ondo` (300 bps) but not here
        MockToken tight = new MockToken();
        tight.setPauseManager(address(pm));
        guard.setAsset(address(tight), ShareGuard.Asset(ShareGuard.Source.Feed, true, 50, ShareGuard.PauseCheck.Manager, address(0)), 1e18);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _update(address(tight), 1.01e18, T0, _now() + 1 hours);
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.UpdateOutOfBounds.selector, address(tight), 1e18, 1.01e18));
        guard.swapForSharesWithFeed(
            address(usdt), 10e18, address(tight), 1, address(router), _data(tight, 10e18, 1e18, address(guard)), user, block.timestamp + 60, u, sig
        );
        vm.stopPrank();
        (u, sig) = _update(address(ondo), 1.01e18, T0, _now() + 1 hours);
        _buyWithFeed(u, sig, 1e18, 1); // +1% passes the 300 bps asset
    }

    function test_heartbeatWithSameValueRefreshesTimestamp() public {
        vm.warp(_now() + 2 days);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1e18, T0 + 2 days);
        _buyWithFeed(u, sig, 1e18, 1);
        (, uint64 at,) = _stored();
        assertEq(at, _now());
    }

    // --- decreases and splits need the owner ---------------------------------------------

    function test_decreaseIsRejectedByDefault() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(0.9999e18, T0);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateOutOfBounds.selector, address(ondo), 1e18, 0.9999e18), u, sig);
    }

    function test_reverseSplitViaCorporateAction() public {
        // SOXS-style 1 -> 0.1: only with the owner's registered action
        guard.registerCorporateAction(address(ondo), 0.1e18, T0);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(0.1e18, T0);
        _approveAll();
        vm.expectEmit(true, false, false, true, address(guard));
        emit ShareGuard.CorporateActionCleared(address(ondo), true);
        _feedCall(u, sig, 10e18, 1);
        (uint256 m,,) = _stored();
        assertEq(m, 0.1e18);
        (uint256 expected,, bool registered) = guard.corporateActionOf(address(ondo));
        assertFalse(registered, "the action is consumed");
        assertEq(expected, 0);
    }

    function test_forwardSplitViaCorporateAction() public {
        guard.registerCorporateAction(address(ondo), 10e18, T0);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(10e18, T0);
        _buyWithFeed(u, sig, 1e18, 1);
        (uint256 m,,) = _stored();
        assertEq(m, 10e18);
    }

    function test_corporateActionMustMatchTheUpdate() public {
        guard.registerCorporateAction(address(ondo), 0.1e18, T0);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(0.2e18, T0);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateOutOfBounds.selector, address(ondo), 1e18, 0.2e18), u, sig);
    }

    function test_corporateActionHonoursNotBefore() public {
        guard.registerCorporateAction(address(ondo), 0.1e18, T0 + 1 days);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(0.1e18, T0);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.CorporateActionNotReady.selector, address(ondo), T0 + 1 days), u, sig);
        vm.warp(T0 + 1 days);
        (u, sig) = _update(address(ondo), 0.1e18, T0, _now() + 1 hours);
        _buyWithFeed(u, sig, 10e18, 1);
    }

    function test_corporateActionIsOneShot() public {
        guard.registerCorporateAction(address(ondo), 0.1e18, T0);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(0.1e18, T0);
        _buyWithFeed(u, sig, 10e18, 1);
        // a later signed update back to 1.0 is a 10x increase: the consumed action cannot be reused
        vm.warp(T0 + 1);
        (u, sig) = _update(address(ondo), 1e18, T0 + 1, _now() + 1 hours);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateOutOfBounds.selector, address(ondo), 0.1e18, 1e18), u, sig);
    }

    function test_ownerCanClearACorporateAction() public {
        guard.registerCorporateAction(address(ondo), 0.1e18, T0);
        vm.expectEmit(true, false, false, true, address(guard));
        emit ShareGuard.CorporateActionCleared(address(ondo), false);
        guard.clearCorporateAction(address(ondo));
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(0.1e18, T0);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateOutOfBounds.selector, address(ondo), 1e18, 0.1e18), u, sig);
    }

    function test_corporateActionOnlyForFeedAssets() public {
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.NotAFeedAsset.selector, address(bstock)));
        guard.registerCorporateAction(address(bstock), 2e18, 0);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.MultiplierUnavailable.selector, address(ondo)));
        guard.registerCorporateAction(address(ondo), 0, 0);
    }

    // --- monotonic and replay --------------------------------------------------------------

    function test_olderSignedUpdateCannotRollBack() public {
        (ShareGuard.FeedUpdate memory u1, bytes memory s1) = _ok(1.01e18, T0 + 10);
        vm.warp(T0 + 10);
        (u1, s1) = _update(address(ondo), 1.01e18, T0 + 10, T0 + 1 hours);
        _buyWithFeed(u1, s1, 1e18, 1);
        // an earlier (still unexpired) update for 1.00 is replayed
        (ShareGuard.FeedUpdate memory old, bytes memory oldSig) = _update(address(ondo), 1e18, T0, T0 + 1 hours);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateOlderThanStored.selector, T0, T0 + 10), old, oldSig);
    }

    function test_sameUpdateMayBeSubmittedByAnotherUser() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1.01e18, T0);
        _buyWithFeed(u, sig, 1e18, 1);
        usdt.mint(user, 10e18);
        _buyWithFeed(u, sig, 1e18, 1); // identical update again: no revert, no change
        (uint256 m,,) = _stored();
        assertEq(m, 1.01e18);
    }

    function test_sameValidAfterWithDifferentValueConflicts() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1.01e18, T0);
        _buyWithFeed(u, sig, 1e18, 1);
        (u, sig) = _ok(1.02e18, T0);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateConflictsWithStored.selector, T0), u, sig);
    }

    function test_updateOutsideItsWindowReverts() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _update(address(ondo), 1.01e18, _now() + 100, _now() + 1 hours);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateNotValidNow.selector, _now() + 100, _now() + 1 hours), u, sig);
        // an expired update (the replay case): signed long ago, window closed
        (u, sig) = _update(address(ondo), 1.01e18, T0 - 2 hours, T0 - 1 hours);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.UpdateNotValidNow.selector, T0 - 2 hours, T0 - 1 hours), u, sig);
    }

    // --- signatures ------------------------------------------------------------------------

    function test_badSignatureReverts() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _updateSignedBy(0xBEEF, address(ondo), 1.01e18, T0, _now() + 1 hours);
        _expectFeedRevert(abi.encodePacked(ShareGuard.InvalidSigner.selector), u, sig);
        // garbage signature bytes
        _expectFeedRevert(abi.encodePacked(ShareGuard.InvalidSigner.selector), u, hex"1234");
    }

    function test_tamperedUpdateReverts() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1.01e18, T0);
        u.multiplier = 1.02e18; // signature no longer matches
        _expectFeedRevert(abi.encodePacked(ShareGuard.InvalidSigner.selector), u, sig);
    }

    function test_signatureIsBoundToThisContract() public {
        // the same update signed for another ShareGuard deployment must not verify here
        ShareGuard other = new ShareGuard(address(this), signer);
        ShareGuard.FeedUpdate memory u = ShareGuard.FeedUpdate(address(ondo), 1.01e18, T0, _now() + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, other.feedUpdateDigest(u));
        _expectFeedRevert(abi.encodePacked(ShareGuard.InvalidSigner.selector), u, abi.encodePacked(r, s, v));
    }

    function test_rotatedSignerInvalidatesTheOldOne() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _ok(1.01e18, T0);
        guard.setFeedSigner(stranger);
        _expectFeedRevert(abi.encodePacked(ShareGuard.InvalidSigner.selector), u, sig);
        guard.setFeedSigner(address(0)); // disabled: nothing verifies
        _expectFeedRevert(abi.encodePacked(ShareGuard.InvalidSigner.selector), u, sig);
    }

    function test_updateForAnotherStockThanTheSwapReverts() public {
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _update(address(bstock), 1.01e18, T0, _now() + 1 hours);
        _expectFeedRevert(abi.encodeWithSelector(ShareGuard.NotAFeedAsset.selector, address(bstock)), u, sig);
    }

    // --- staleness -------------------------------------------------------------------------

    function test_staleFeedRevertsWithoutAFreshUpdate() public {
        vm.warp(T0 + 3 days); // exactly maxAge: still fine
        assertEq(_buy(ondo, 10e18, 1e18, 1), 1e18);
        vm.warp(T0 + 3 days + 1);
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.FeedStale.selector, address(ondo), T0, uint64(3 days)));
        guard.swapForShares(
            address(usdt), 10e18, address(ondo), 1, address(router), _data(ondo, 10e18, 1e18, address(guard)), user, block.timestamp
        );
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.FeedStale.selector, address(ondo), T0, uint64(3 days)));
        guard.sharesPerToken(address(ondo));
    }

    function test_freshUpdateRescuesAStaleFeed() public {
        vm.warp(T0 + 5 days);
        (ShareGuard.FeedUpdate memory u, bytes memory sig) = _update(address(ondo), 1.002e18, T0 + 5 days, T0 + 5 days + 1 hours);
        assertEq(_buyWithFeed(u, sig, 1e18, 1), 1.002e18);
    }

    function test_shorterMaxAgeTightensStaleness() public {
        guard.setMaxAge(1 hours);
        vm.warp(T0 + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.FeedStale.selector, address(ondo), T0, uint64(1 hours)));
        guard.sharesPerToken(address(ondo));
    }

    // --- helpers ---------------------------------------------------------------------------
}
