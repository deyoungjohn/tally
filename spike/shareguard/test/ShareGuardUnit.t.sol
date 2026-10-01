// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {BatchExecutor} from "../src/BatchExecutor.sol";
import {MockToken, MockRouter} from "./Mocks.sol";

/// Offline tests (no RPC, no API key): contract logic and EIP-7702 batch mechanics.
contract ShareGuardUnitTest is Test {
    uint256 constant USER_PK = 0xA11CE;
    address user;
    MockToken usdt;
    MockToken stock;
    MockRouter router;
    ShareGuard guard;

    function setUp() public {
        user = vm.addr(USER_PK);
        usdt = new MockToken();
        stock = new MockToken();
        router = new MockRouter();
        guard = new ShareGuard(address(this));
        guard.setAsset(address(stock), ShareGuard.Source.UiMultiplier, 0);
        usdt.mint(user, 100e18);
    }

    function _swapData(uint256 spend, uint256 out, address recipient) internal view returns (bytes memory) {
        return abi.encodeCall(MockRouter.swap, (usdt, spend, stock, out, recipient));
    }

    function _guardSwap(uint256 spend, uint256 out, address recipient, uint256 minShares) internal returns (uint256) {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        uint256 shares = guard.swapForShares(
            address(usdt), 10e18, address(router), address(router), _swapData(spend, out, recipient),
            address(stock), minShares, user
        );
        vm.stopPrank();
        return shares;
    }

    function test_convertsTokensToSharesWithOnchainMultiplier() public {
        stock.setUiMultiplier(1.000778e18);
        uint256 shares = _guardSwap(10e18, 0.04e18, address(guard), 0.04e18);
        assertEq(stock.balanceOf(user), 0.04e18, "tokens forwarded to recipient");
        assertEq(shares, 0.04e18 * 1.000778e18 / 1e18, "shares = tokens x multiplier");
        assertEq(stock.balanceOf(address(guard)), 0, "guard keeps nothing");
    }

    function test_revertsBelowMinShares() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.InsufficientShares.selector, 0.04e18, 0.05e18));
        guard.swapForShares(
            address(usdt), 10e18, address(router), address(router), _swapData(10e18, 0.04e18, address(guard)),
            address(stock), 0.05e18, user
        );
        vm.stopPrank();
        assertEq(usdt.balanceOf(user), 100e18, "nothing spent on revert");
    }

    /// The NFLX case: Ondo token = 10 shares. A token-denominated minimum of 1 would accept
    /// 0.1 token (= 1 share) as if it were 1 share; a share-denominated minimum does not.
    function test_splitAdjustedTokenUsesShares() public {
        guard.setAsset(address(stock), ShareGuard.Source.Feed, 10e18);
        uint256 shares = _guardSwap(10e18, 0.1e18, address(guard), 1e18);
        assertEq(shares, 1e18, "0.1 token x 10 = 1 share");
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectPartialRevert(ShareGuard.InsufficientShares.selector);
        guard.swapForShares(
            address(usdt), 10e18, address(router), address(router), _swapData(10e18, 0.1e18, address(guard)),
            address(stock), 2e18, user
        );
        vm.stopPrank();
    }

    function test_revertsWhenRouteDeliversElsewhere() public {
        vm.startPrank(user, user);
        usdt.approve(address(guard), 10e18);
        vm.expectRevert(ShareGuard.NoOutput.selector);
        guard.swapForShares(
            address(usdt), 10e18, address(router), address(router), _swapData(10e18, 1e18, address(0xBEEF)),
            address(stock), 0, user
        );
        vm.stopPrank();
    }

    function test_refundsUnspentInputAndClearsAllowance() public {
        _guardSwap(7e18, 1e18, address(guard), 0);
        assertEq(usdt.balanceOf(user), 93e18, "3 unspent USDT refunded");
        assertEq(usdt.allowance(address(guard), address(router)), 0, "allowance cleared");
    }

    function test_unknownAssetReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ShareGuard.UnknownAsset.selector, address(usdt)));
        guard.sharesPerToken(address(usdt));
    }

    function test_onlyOwnerSetsAssets() public {
        vm.prank(user);
        vm.expectRevert(ShareGuard.NotOwner.selector);
        guard.setAsset(address(stock), ShareGuard.Source.Feed, 1e18);
    }

    function _batch(uint256 minShares) internal view returns (BatchExecutor.Call[] memory calls) {
        calls = new BatchExecutor.Call[](3);
        calls[0] = BatchExecutor.Call(address(usdt), 0, abi.encodeCall(MockToken.approve, (address(router), 10e18)));
        calls[1] = BatchExecutor.Call(address(router), 0, _swapData(10e18, 0.04e18, user));
        calls[2] = BatchExecutor.Call(
            address(guard), 0, abi.encodeCall(ShareGuard.assertMinShares, (user, address(stock), 0, minShares))
        );
    }

    function test_7702BatchSwapThenAssert() public {
        BatchExecutor impl = new BatchExecutor();
        BatchExecutor.Call[] memory calls = _batch(0.04e18);
        vm.signAndAttachDelegation(address(impl), USER_PK);
        vm.prank(user, user);
        BatchExecutor(user).execute(calls);
        assertEq(stock.balanceOf(user), 0.04e18);
        assertEq(usdt.balanceOf(user), 90e18);
    }

    function test_7702BatchRevertsAtomicallyOnShortfall() public {
        BatchExecutor impl = new BatchExecutor();
        BatchExecutor.Call[] memory calls = _batch(0.05e18);
        vm.signAndAttachDelegation(address(impl), USER_PK);
        vm.prank(user, user);
        vm.expectPartialRevert(BatchExecutor.CallFailed.selector);
        BatchExecutor(user).execute(calls);
        assertEq(usdt.balanceOf(user), 100e18, "swap rolled back with the failed check");
        assertEq(stock.balanceOf(user), 0);
    }
}
