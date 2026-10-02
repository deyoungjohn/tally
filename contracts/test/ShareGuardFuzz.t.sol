// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {GuardBase} from "./Base.t.sol";
import {ShareGuard} from "../src/ShareGuard.sol";

/// Property tests over amounts, multipliers (1e15 to 1e20), tolerance and refund maths.
contract ShareGuardFuzzTest is GuardBase {
    uint256 constant M_MIN = 1e15;
    uint256 constant M_MAX = 1e20;

    function _fund(uint256 amountIn) internal {
        usdt.mint(user, amountIn); // on top of setUp's 100e18
        vm.prank(user);
        usdt.approve(address(guard), amountIn);
    }

    function _swap(uint256 amountIn, uint256 spend, uint256 out, uint256 minShares) internal returns (uint256) {
        bytes memory d = _data(bstock, spend, out, address(guard));
        vm.prank(user, user);
        return guard.swapForShares(address(usdt), amountIn, address(bstock), minShares, address(router), d, user, block.timestamp);
    }

    /// shares = tokens x multiplier / 1e18 exactly (rounded down), whatever the multiplier.
    function testFuzz_sharesMatchMultiplierMaths(uint256 m, uint256 amountIn, uint256 out) public {
        m = bound(m, M_MIN, M_MAX);
        amountIn = bound(amountIn, 1, 1e30);
        out = bound(out, 1, 1e30);
        bstock.setUiMultiplier(m);
        _fund(amountIn);
        uint256 expected = out * m / 1e18;
        if (expected == 0) {
            // dust that rounds to zero shares can never satisfy a non-zero minimum
            vm.expectRevert(abi.encodeWithSelector(ShareGuard.InsufficientShares.selector, 0, 1));
            _swap(amountIn, amountIn, out, 1);
            return;
        }
        uint256 shares = _swap(amountIn, amountIn, out, expected);
        assertEq(shares, expected);
        assertEq(bstock.balanceOf(user), out, "all tokens forwarded");
        assertEq(bstock.balanceOf(address(guard)), 0, "guard holds no stock");
    }

    /// One unit short of the share minimum always reverts, and nothing is spent.
    function testFuzz_minimumIsExact(uint256 m, uint256 out) public {
        m = bound(m, M_MIN, M_MAX);
        out = bound(out, 1e3, 1e30);
        bstock.setUiMultiplier(m);
        uint256 expected = out * m / 1e18;
        vm.assume(expected > 0);
        _fund(10e18);
        uint256 before = usdt.balanceOf(user);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InsufficientShares.selector, expected, expected + 1));
        _swap(10e18, 10e18, out, expected + 1);
        assertEq(usdt.balanceOf(user), before, "nothing spent on revert");
    }

    /// Refund maths: whatever the router leaves unspent comes back, the guard ends at zero and the
    /// approval is cleared.
    function testFuzz_refundAndNoResidue(uint256 amountIn, uint256 spend, uint256 out) public {
        amountIn = bound(amountIn, 1, 1e30);
        spend = bound(spend, 0, amountIn);
        out = bound(out, 1, 1e30);
        _fund(amountIn);
        uint256 before = usdt.balanceOf(user);
        _swap(amountIn, spend, out, 1);
        assertEq(usdt.balanceOf(user), before - spend, "refund = amountIn - spend");
        assertEq(usdt.balanceOf(address(guard)), 0);
        assertEq(bstock.balanceOf(address(guard)), 0);
        assertEq(usdt.allowance(address(guard), address(router)), 0);
    }

    /// A user-chosen tolerance never rejects a fill at or above (quote x (1 - tolerance)).
    function testFuzz_toleranceAcceptsFillsAboveTheMinimum(uint256 m, uint256 quoted, uint256 tolBps, uint256 fillBps)
        public
    {
        m = bound(m, M_MIN, M_MAX);
        quoted = bound(quoted, 1e6, 1e28);
        tolBps = bound(tolBps, 0, 1000);
        bstock.setUiMultiplier(m);
        uint256 quotedShares = quoted * m / 1e18;
        vm.assume(quotedShares > 0);
        uint256 minShares = quotedShares * (10_000 - tolBps) / 10_000;
        vm.assume(minShares > 0);
        // the fill ranges from 1% below the minimum to 1% above the quote
        fillBps = bound(fillBps, 9_900, 10_100);
        uint256 out = quoted * fillBps / 10_000;
        vm.assume(out > 0);
        _fund(10e18);
        uint256 got = out * m / 1e18;
        if (got >= minShares) {
            assertEq(_swap(10e18, 10e18, out, minShares), got);
        } else {
            vm.expectRevert(abi.encodeWithSelector(ShareGuard.InsufficientShares.selector, got, minShares));
            _swap(10e18, 10e18, out, minShares);
        }
    }

    /// Feed bound, per asset: a signed update passes iff it is an increase of at most maxStepBps.
    /// A decrease or a larger increase reverts when no corporate action is registered.
    function testFuzz_feedBoundIsExact(uint256 seed, uint256 proposed, uint16 stepBps) public {
        seed = bound(seed, M_MIN, M_MAX);
        proposed = bound(proposed, M_MIN, M_MAX);
        stepBps = uint16(bound(stepBps, 1, 1000));
        bstock.setUiMultiplier(1e18); // keep the unrelated asset sane
        ShareGuard fresh = new ShareGuard(address(this), signer);
        fresh.setRouter(address(router), true, address(router));
        fresh.setAsset(
            address(ondo),
            ShareGuard.Asset(ShareGuard.Source.Feed, true, stepBps, ShareGuard.PauseCheck.Manager, address(0)),
            seed
        );
        uint64 va = uint64(block.timestamp);
        ShareGuard.FeedUpdate memory u = ShareGuard.FeedUpdate(address(ondo), proposed, va, va + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, fresh.feedUpdateDigest(u));
        bytes memory sig = abi.encodePacked(r, s, v);
        usdt.mint(user, 10e18);
        vm.prank(user);
        usdt.approve(address(fresh), 10e18);
        bytes memory d = _data(ondo, 10e18, 1e18, address(fresh));

        bool allowed = proposed == seed || (proposed > seed && (proposed - seed) * 10_000 <= seed * stepBps);
        if (!allowed) vm.expectRevert(abi.encodeWithSelector(ShareGuard.UpdateOutOfBounds.selector, address(ondo), seed, proposed));
        _feedSwap(fresh, d, u, sig);
        if (allowed) {
            (uint256 m,,) = fresh.feedOf(address(ondo));
            assertEq(m, proposed);
        }
    }

    /// The guard never calls an address that is not an allow-listed router, whatever it is.
    function testFuzz_onlyAllowListedRoutersAreCalled(address anyRouter, bytes calldata data) public {
        vm.assume(anyRouter != address(router));
        _fund(10e18);
        vm.prank(user, user);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.RouterNotAllowed.selector, anyRouter));
        guard.swapForShares(address(usdt), 10e18, address(bstock), 1, anyRouter, data, user, block.timestamp);
    }

    function _feedSwap(ShareGuard g, bytes memory d, ShareGuard.FeedUpdate memory u, bytes memory sig) internal {
        vm.prank(user, user);
        g.swapForSharesWithFeed(address(usdt), 10e18, address(ondo), 1, address(router), d, user, block.timestamp, u, sig);
    }
}
