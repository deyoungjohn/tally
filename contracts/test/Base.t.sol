// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {MockToken, MockRouter, MockPauseManager} from "./Mocks.sol";

/// Shared fixture: a bStock-like asset (uiMultiplier, fixed pause manager) and an Ondo-like
/// asset (signed feed, pause manager read from the token), both bought with a mock USDT.
abstract contract GuardBase is Test {
    uint256 constant USER_PK = 0xA11CE;
    uint256 constant SIGNER_PK = 0x51611E4;

    address user;
    address signer;
    address stranger = address(0xBAD);

    MockToken usdt;
    MockToken bstock;
    MockToken ondo;
    MockRouter router;
    MockPauseManager pm;
    ShareGuard guard;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        user = vm.addr(USER_PK);
        signer = vm.addr(SIGNER_PK);
        usdt = new MockToken();
        bstock = new MockToken();
        ondo = new MockToken();
        router = new MockRouter();
        pm = new MockPauseManager();
        guard = new ShareGuard(address(this), signer);
        guard.setRouter(address(router), true, address(router));

        guard.setAsset(
            address(bstock),
            ShareGuard.Asset(ShareGuard.Source.UiMultiplier, true, 0, ShareGuard.PauseCheck.Manager, address(pm)),
            0
        );
        ondo.setPauseManager(address(pm));
        guard.setAsset(
            address(ondo),
            ShareGuard.Asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.Manager, address(0)),
            1e18
        );
        usdt.mint(user, 100e18);
    }

    function _data(MockToken stock, uint256 spend, uint256 out, address recipient) internal view returns (bytes memory) {
        return abi.encodeCall(MockRouter.swap, (usdt, spend, stock, out, recipient));
    }

    /// bStock buy of 10 USDT through the mock router; returns shares.
    function _buy(MockToken stock, uint256 spend, uint256 out, uint256 minShares) internal returns (uint256) {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        uint256 shares = guard.swapForShares(
            address(usdt), 10e18, address(stock), minShares, address(router), _data(stock, spend, out, address(guard)), user, block.timestamp + 60
        );
        vm.stopPrank();
        return shares;
    }

    function _update(address stock, uint256 m, uint64 validAfter, uint64 validUntil)
        internal
        view
        returns (ShareGuard.FeedUpdate memory u, bytes memory sig)
    {
        return _updateSignedBy(SIGNER_PK, stock, m, validAfter, validUntil);
    }

    function _updateSignedBy(uint256 pk, address stock, uint256 m, uint64 validAfter, uint64 validUntil)
        internal
        view
        returns (ShareGuard.FeedUpdate memory u, bytes memory sig)
    {
        u = ShareGuard.FeedUpdate(stock, m, validAfter, validUntil);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, guard.feedUpdateDigest(u));
        sig = abi.encodePacked(r, s, v);
    }

    function _approveAll() internal {
        vm.prank(user);
        usdt.approve(address(guard), 10e18);
    }

    /// One swapForSharesWithFeed call on the Ondo asset (no approval: call _approveAll first).
    function _feedCall(ShareGuard.FeedUpdate memory u, bytes memory sig, uint256 out, uint256 minShares)
        internal
        returns (uint256)
    {
        bytes memory d = _data(ondo, 10e18, out, address(guard));
        vm.prank(user, user);
        return guard.swapForSharesWithFeed(
            address(usdt), 10e18, address(ondo), minShares, address(router), d, user, block.timestamp + 60, u, sig
        );
    }

    function _buyWithFeed(ShareGuard.FeedUpdate memory u, bytes memory sig, uint256 out, uint256 minShares)
        internal
        returns (uint256)
    {
        _approveAll();
        return _feedCall(u, sig, out, minShares);
    }

    /// Approves, then expects `err` from a single swapForSharesWithFeed call on the Ondo asset.
    function _expectFeedRevert(bytes memory err, ShareGuard.FeedUpdate memory u, bytes memory sig) internal {
        vm.prank(user);
        usdt.approve(address(guard), 10e18);
        bytes memory d = _data(ondo, 10e18, 1e18, address(guard));
        vm.expectRevert(err);
        vm.prank(user, user);
        guard.swapForSharesWithFeed(address(usdt), 10e18, address(ondo), 1, address(router), d, user, block.timestamp + 60, u, sig);
    }
}
