// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {GuardBase} from "./Base.t.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {MockToken} from "./Mocks.sol";

/// Owner powers, allow-list validation, rescue and the two-step ownership hand-over.
contract ShareGuardAdminTest is GuardBase {
    function _asset(ShareGuard.Source s, bool en, uint16 bps, ShareGuard.PauseCheck pc, address pmgr)
        internal
        pure
        returns (ShareGuard.Asset memory)
    {
        return ShareGuard.Asset(s, en, bps, pc, pmgr);
    }

    function test_onlyOwnerCanManage() public {
        vm.startPrank(stranger);
        bytes memory denied = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        vm.expectRevert(denied);
        guard.setRouter(address(0x1234), true, address(0x1234));
        vm.expectRevert(denied);
        guard.setAsset(
            address(bstock), _asset(ShareGuard.Source.UiMultiplier, true, 0, ShareGuard.PauseCheck.None, address(0)), 0
        );
        vm.expectRevert(denied);
        guard.registerCorporateAction(address(ondo), 2e18, 0);
        vm.expectRevert(denied);
        guard.clearCorporateAction(address(ondo));
        vm.expectRevert(denied);
        guard.setFeedSigner(stranger);
        vm.expectRevert(denied);
        guard.setMaxAge(2 days);
        vm.expectRevert(denied);
        guard.pause();
        vm.expectRevert(denied);
        guard.unpause();
        vm.expectRevert(denied);
        guard.rescue(address(usdt), stranger);
        vm.stopPrank();
    }

    // --- routers ---------------------------------------------------------------------------

    function test_setRouterEmitsAndStores() public {
        address r = address(0x1234);
        address t = address(0x5678);
        vm.expectEmit(true, false, false, true, address(guard));
        emit ShareGuard.RouterSet(r, true, t);
        guard.setRouter(r, true, t);
        assertTrue(guard.allowedRouter(r));
        assertEq(guard.approveTargetOf(r), t);

        vm.expectEmit(true, false, false, true, address(guard));
        emit ShareGuard.RouterSet(r, false, address(0));
        guard.setRouter(r, false, address(0));
        assertFalse(guard.allowedRouter(r));
        assertEq(guard.approveTargetOf(r), address(0));
    }

    function test_routerConfigValidation() public {
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidRouterConfig.selector, address(0)));
        guard.setRouter(address(0), true, address(1));
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidRouterConfig.selector, address(1)));
        guard.setRouter(address(1), true, address(0));
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidRouterConfig.selector, address(guard)));
        guard.setRouter(address(guard), true, address(1));
        // a configured stock token can never become a router or approve target
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidRouterConfig.selector, address(bstock)));
        guard.setRouter(address(bstock), true, address(bstock));
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidRouterConfig.selector, address(0x77)));
        guard.setRouter(address(0x77), true, address(ondo));
    }

    // --- assets ----------------------------------------------------------------------------

    function test_assetConfigValidation() public {
        MockToken t = new MockToken();
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(0)));
        guard.setAsset(address(0), _asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.None, address(0)), 0);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(guard)));
        guard.setAsset(
            address(guard), _asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.None, address(0)), 0
        );
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(0xEE))); // no code
        guard.setAsset(
            address(0xEE), _asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.None, address(0)), 0
        );
        // a router can never be a stock
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(router)));
        guard.setAsset(
            address(router), _asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.None, address(0)), 0
        );
        // no source
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(t)));
        guard.setAsset(address(t), _asset(ShareGuard.Source.None, true, 0, ShareGuard.PauseCheck.None, address(0)), 0);
        // step above the cap, and an enabled Feed with no step
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(t)));
        guard.setAsset(
            address(t), _asset(ShareGuard.Source.Feed, true, 1001, ShareGuard.PauseCheck.None, address(0)), 1e18
        );
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(t)));
        guard.setAsset(
            address(t), _asset(ShareGuard.Source.Feed, true, 0, ShareGuard.PauseCheck.None, address(0)), 1e18
        );
        // a fixed pause manager only makes sense with PauseCheck.Manager
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidAssetConfig.selector, address(t)));
        guard.setAsset(
            address(t), _asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.TokenFlag, address(pm)), 1e18
        );
        // the cap itself is fine
        guard.setAsset(
            address(t), _asset(ShareGuard.Source.Feed, true, 1000, ShareGuard.PauseCheck.None, address(0)), 1e18
        );
    }

    function test_setAssetEmits() public {
        vm.expectEmit(true, false, false, true, address(guard));
        emit ShareGuard.AssetSet(
            address(bstock), ShareGuard.Source.UiMultiplier, false, 0, ShareGuard.PauseCheck.None, address(0)
        );
        guard.setAsset(
            address(bstock), _asset(ShareGuard.Source.UiMultiplier, false, 0, ShareGuard.PauseCheck.None, address(0)), 0
        );
        assertFalse(guard.assetOf(address(bstock)).enabled);
    }

    function test_feedSeedOnlyOnce() public {
        // the seed from setUp is 1e18; re-configuring the asset cannot reseed it
        guard.setAsset(
            address(ondo), _asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.Manager, address(0)), 5e18
        );
        assertEq(guard.sharesPerToken(address(ondo)), 1e18, "seed applies only while never seeded");
        (uint256 m,,) = guard.feedOf(address(ondo));
        assertEq(m, 1e18);
    }

    function test_feedAssetNotSeededReverts() public {
        MockToken t = new MockToken();
        guard.setAsset(address(t), _asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.None, address(0)), 0);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.FeedNotSeeded.selector, address(t)));
        guard.sharesPerToken(address(t));
    }

    // --- settings --------------------------------------------------------------------------

    function test_maxAgeBounds() public {
        assertEq(guard.maxAge(), 3 days);
        guard.setMaxAge(1 hours);
        guard.setMaxAge(7 days);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidMaxAge.selector, uint64(1 hours - 1)));
        guard.setMaxAge(1 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InvalidMaxAge.selector, uint64(7 days + 1)));
        guard.setMaxAge(7 days + 1);
    }

    function test_setFeedSignerEmits() public {
        vm.expectEmit(true, false, false, false, address(guard));
        emit ShareGuard.FeedSignerSet(stranger);
        guard.setFeedSigner(stranger);
        assertEq(guard.feedSigner(), stranger);
    }

    // --- rescue ----------------------------------------------------------------------------

    function test_rescueSweepsTokensAndEmits() public {
        usdt.mint(address(guard), 5e18);
        vm.expectEmit(true, true, false, true, address(guard));
        emit ShareGuard.Rescued(address(usdt), stranger, 5e18);
        guard.rescue(address(usdt), stranger);
        assertEq(usdt.balanceOf(stranger), 5e18);
        assertEq(usdt.balanceOf(address(guard)), 0);
    }

    function test_rescueNative() public {
        vm.deal(address(guard), 1 ether);
        guard.rescue(address(0), stranger);
        assertEq(stranger.balance, 1 ether);
        assertEq(address(guard).balance, 0);
    }

    function test_rescueRejectsZeroRecipient() public {
        vm.expectRevert(ShareGuard.ZeroAddress.selector);
        guard.rescue(address(usdt), address(0));
    }

    // --- ownership (two-step) --------------------------------------------------------------

    function test_ownershipIsTwoStep() public {
        guard.transferOwnership(stranger);
        assertEq(guard.owner(), address(this), "still the old owner until accepted");
        assertEq(guard.pendingOwner(), stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        guard.acceptOwnership();
        vm.prank(stranger);
        guard.acceptOwnership();
        assertEq(guard.owner(), stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        guard.pause();
    }

    function test_noUpgradeSurface() public view {
        // not a proxy: there is no implementation slot and no upgrade entry point
        bytes32 implSlot = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
        assertEq(vm.load(address(guard), implSlot), bytes32(0));
    }
}
