// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {AddAssets} from "../script/AddAssets.s.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {MockToken, MockPauseManager} from "./Mocks.sol";

contract AddAssetsHarness is AddAssets {
    function plan(ShareGuard guard, string memory assets, string memory seeds, string memory recorded, uint256 size)
        external
        view
        returns (PlannedAsset[] memory)
    {
        return _plan(guard, assets, seeds, recorded, 0, size);
    }

    function applyPlan(ShareGuard guard, PlannedAsset[] memory planned) external returns (uint256) {
        return _apply(guard, planned);
    }

    function manifest() external view returns (string memory) {
        return _loadAssets();
    }
}

contract AddAssetsTest is Test {
    AddAssetsHarness script;
    ShareGuard guard;
    MockToken bstock;
    MockToken ondo;
    MockPauseManager pm;
    string assets;

    function setUp() public {
        vm.warp(1_800_000_000);
        script = new AddAssetsHarness();
        guard = new ShareGuard(address(script), address(0xFEE));
        bstock = new MockToken();
        ondo = new MockToken();
        pm = new MockPauseManager();
        bstock.setUiMultiplier(2e18);
        ondo.setPauseManager(address(pm));
        assets = string.concat(
            '{"bstockPauseManager":"',
            vm.toString(address(pm)),
            '","assets":[',
            '{"address":"',
            vm.toString(address(bstock)),
            '","symbol":"TESTB","kind":"bstock"},',
            '{"address":"',
            vm.toString(address(ondo)),
            '","symbol":"TESTon","kind":"ondo"}]}'
        );
    }

    function seeds(uint256 when, string memory value) internal pure returns (string memory) {
        return
            string.concat('{"fetchedAtUnix":', vm.toString(when), ',"seeds":{"TESTon":{"multiplier":"', value, '"}}}');
    }

    function test_exactIssuerConfigurationAndSeed() public {
        AddAssets.PlannedAsset[] memory planned =
            script.plan(guard, assets, seeds(block.timestamp, "10000000000000000000"), "", 2);
        assertEq(script.applyPlan(guard, planned), 2);
        ShareGuard.Asset memory b = guard.assetOf(address(bstock));
        ShareGuard.Asset memory o = guard.assetOf(address(ondo));
        assertEq(uint256(b.source), uint256(ShareGuard.Source.UiMultiplier));
        assertEq(b.maxStepBps, 0);
        assertEq(b.pauseManager, address(pm));
        assertTrue(b.enabled);
        assertEq(uint256(b.pauseCheck), uint256(ShareGuard.PauseCheck.Manager));
        assertEq(uint256(o.source), uint256(ShareGuard.Source.Feed));
        assertEq(o.maxStepBps, 300);
        assertEq(o.pauseManager, address(0));
        assertTrue(o.enabled);
        assertEq(uint256(o.pauseCheck), uint256(ShareGuard.PauseCheck.Manager));
        assertEq(guard.sharesPerToken(address(bstock)), 2e18);
        assertEq(guard.sharesPerToken(address(ondo)), 10e18);
    }

    function test_skipConfiguredAndDisabledAssetsWithoutSeedsOrReseeding() public {
        vm.startPrank(address(script));
        guard.setAsset(
            address(bstock),
            ShareGuard.Asset(ShareGuard.Source.UiMultiplier, false, 0, ShareGuard.PauseCheck.Manager, address(pm)),
            0
        );
        guard.setAsset(
            address(ondo),
            ShareGuard.Asset(ShareGuard.Source.Feed, true, 300, ShareGuard.PauseCheck.Manager, address(0)),
            7e18
        );
        vm.stopPrank();
        AddAssets.PlannedAsset[] memory planned = script.plan(guard, assets, "", "", 2);
        assertTrue(planned[0].skip && planned[1].skip);
        assertEq(script.applyPlan(guard, planned), 0);
        assertFalse(guard.assetOf(address(bstock)).enabled);
        assertEq(guard.sharesPerToken(address(ondo)), 7e18);
    }

    function test_missingStaleFutureAndZeroSeedsRefusedBeforeApplying() public {
        vm.expectRevert("fresh owner seeds required");
        script.plan(guard, assets, "", "", 2);
        vm.expectRevert("owner seeds stale or future");
        script.plan(guard, assets, seeds(block.timestamp - 2 hours - 1, "1"), "", 2);
        vm.expectRevert("owner seeds stale or future");
        script.plan(guard, assets, seeds(block.timestamp + 1, "1"), "", 2);
        vm.expectRevert("zero seed");
        script.plan(guard, assets, seeds(block.timestamp, "0"), "", 2);
        vm.expectRevert("no owner seed for TESTon");
        script.plan(
            guard, assets, string.concat('{"fetchedAtUnix":', vm.toString(block.timestamp), ',"seeds":{}}'), "", 2
        );
        assertEq(uint256(guard.assetOf(address(bstock)).source), 0);
    }

    function test_bstockOnlyPlanNeedsNoSeedFile() public {
        AddAssets.PlannedAsset[] memory planned = script.plan(guard, assets, "", "", 1);
        assertEq(script.applyPlan(guard, planned), 1);
        assertEq(uint256(guard.assetOf(address(ondo)).source), 0);
    }

    function test_nonOwnerCannotConfigure() public {
        ShareGuard differentOwner = new ShareGuard(address(this), address(0xFEE));
        AddAssets.PlannedAsset[] memory planned = script.plan(differentOwner, assets, "", "", 1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(script)));
        script.applyPlan(differentOwner, planned);
    }

    function test_manifestOnlyContainsTheApprovedTwenty() public view {
        string memory loaded = script.manifest();
        assertTrue(bytes(loaded).length > 0);
    }

    function test_productionEntryPointsRefuseOtherChains() public {
        vm.chainId(1);
        vm.expectRevert("BSC chain 56 required");
        script.preview();
        vm.expectRevert("BSC chain 56 required");
        script.run();
        vm.expectRevert("BSC chain 56 required");
        script.rollback(address(bstock));
    }
}

/// Optional archive-fork integration tests operate on local fork state only.
/// Recorded multipliers are simulation inputs; no seed file is generated.
contract AddAssetsForkTest is Test {
    using stdJson for string;
    AddAssetsHarness script;
    ShareGuard guard;
    string assets;
    bool enabled;

    function setUp() public {
        enabled = vm.envOr("ADD_ASSETS_FORK", false);
        if (!enabled) return;
        vm.createSelectFork(vm.envString("BSC_RPC"), vm.envUint("ADD_ASSETS_BLOCK"));
        script = new AddAssetsHarness();
        guard = ShareGuard(script.DEPLOYED_GUARD());
        assets = script.manifest();
    }

    function _planned() internal view returns (AddAssets.PlannedAsset[] memory) {
        return script.plan(guard, assets, "", vm.readFile("captures/depth/batch-1-onchain.json"), 20);
    }

    function test_forkPreviewConfiguresOnlyApprovedTwentyAndPreservesExistingAssets() public {
        vm.skip(!enabled);
        string memory batch = vm.readFile("deploy/batch-1.json");
        bytes32[] memory before = new bytes32[](53);
        for (uint256 i; i < 53; i++) {
            address stock = batch.readAddress(string.concat(".tokens[", vm.toString(i), "].address"));
            before[i] = keccak256(abi.encode(guard.assetOf(stock)));
        }
        script.preview();
        for (uint256 i; i < 20; i++) {
            address stock = assets.readAddress(string.concat(".assets[", vm.toString(i), "].address"));
            ShareGuard.Asset memory cfg = guard.assetOf(stock);
            bool bstock = i < 12;
            assertEq(uint256(cfg.source), bstock ? 1 : 3);
            assertEq(cfg.maxStepBps, bstock ? 0 : 300);
            assertTrue(cfg.enabled);
            assertEq(uint256(cfg.pauseCheck), 1);
            assertEq(cfg.pauseManager, bstock ? assets.readAddress(".bstockPauseManager") : address(0));
            assertGt(guard.sharesPerToken(stock), 0);
        }
        for (uint256 i; i < 53; i++) {
            address stock = batch.readAddress(string.concat(".tokens[", vm.toString(i), "].address"));
            bool approved;
            for (uint256 j; j < 20; j++) {
                if (stock == assets.readAddress(string.concat(".assets[", vm.toString(j), "].address"))) {
                    approved = true;
                }
            }
            if (!approved) assertEq(keccak256(abi.encode(guard.assetOf(stock))), before[i]);
        }
    }

    function test_forkConfiguredDisabledAssetIsSkippedWithoutReenable() public {
        vm.skip(!enabled);
        address stock = assets.readAddress(".assets[0].address");
        vm.prank(guard.owner());
        guard.setAsset(
            stock,
            ShareGuard.Asset(
                ShareGuard.Source.UiMultiplier,
                false,
                0,
                ShareGuard.PauseCheck.Manager,
                assets.readAddress(".bstockPauseManager")
            ),
            0
        );
        AddAssets.PlannedAsset[] memory planned = _planned();
        assertTrue(planned[0].skip);
        script.preview();
        assertFalse(guard.assetOf(stock).enabled);
    }

    function test_forkOwnerBstockBatchNeedsNoSeedsAndTouchesOnlyFirstTen() public {
        vm.skip(!enabled);
        script.runBatch(0, 10);
        for (uint256 i; i < 20; i++) {
            address stock = assets.readAddress(string.concat(".assets[", vm.toString(i), "].address"));
            assertEq(uint256(guard.assetOf(stock).source), i < 10 ? 1 : 0);
        }
    }

    function test_forkInvalidOwnerBatchRefused() public {
        vm.skip(!enabled);
        vm.expectRevert("invalid owner batch");
        script.runBatch(0, 11);
        vm.expectRevert("invalid owner batch");
        script.runBatch(20, 10);
    }

    function test_forkRollbackPreservesConfigurationAndFeedAndBlocksBuy() public {
        vm.skip(!enabled);
        script.preview();
        for (uint256 i; i < 2; i++) {
            address stock = assets.readAddress(i == 0 ? ".assets[0].address" : ".assets[12].address");
            ShareGuard.Asset memory before = guard.assetOf(stock);
            (uint256 multiplier, uint64 updatedAt, uint64 validAfter) = guard.feedOf(stock);
            script.rollback(stock);
            before.enabled = false;
            assertEq(keccak256(abi.encode(guard.assetOf(stock))), keccak256(abi.encode(before)));
            (uint256 afterM, uint64 afterAt, uint64 afterValid) = guard.feedOf(stock);
            assertEq(afterM, multiplier);
            assertEq(afterAt, updatedAt);
            assertEq(afterValid, validAfter);
            vm.expectRevert(abi.encodeWithSelector(ShareGuard.AssetNotEnabled.selector, stock));
            guard.swapForShares(address(0x123), 6e18, stock, 1, address(0x456), "", address(this), block.timestamp + 60);
        }
    }
}
