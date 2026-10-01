// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "forge-std/interfaces/IERC20.sol";
import {ShareGuard} from "../src/ShareGuard.sol";
import {BatchExecutor} from "../src/BatchExecutor.sol";

/// Replays REAL Trading API swap calldata (captured by spike/capture_route.py) on a BSC
/// mainnet fork. Each test is an experiment; a failure is a finding, so every failure logs
/// the router's revert data.
///   CAPTURE=../captures/NVDAB.json BSC_RPC=<url> forge test --match-contract Fork -vv
/// Without CAPTURE set, every test is skipped (so `forge test` stays offline).
contract ShareGuardForkTest is Test {
    using stdJson for string;

    uint256 constant TEST_PK = 0xA11CE;
    address constant TEST_USER = 0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7; // vm.addr(TEST_PK)
    address constant GUARD = 0xcb634955B8A7DF7B106f7AB47C9759B26206b777; // capture_route.GUARD_ADDR

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
    string token;
    address stock;
    address usdt;
    uint256 amountIn;
    ShareGuard guard;

    function setUp() public {
        string memory path = vm.envOr("CAPTURE", string(""));
        if (bytes(path).length == 0) return;
        vm.createSelectFork(vm.envString("BSC_RPC"));
        json = vm.readFile(path);
        haveCapture = true;
        token = json.readString(".token");
        stock = json.readAddress(".tokenAddress");
        usdt = json.readAddress(".tokenIn");
        amountIn = vm.parseUint(json.readString(".amountIn"));
        assertEq(vm.addr(TEST_PK), TEST_USER, "test key / capture user mismatch");

        deployCodeTo("ShareGuard.sol:ShareGuard", abi.encode(address(this)), GUARD);
        guard = ShareGuard(GUARD);
        bytes32 src = keccak256(bytes(json.readString(".multiplierSource")));
        if (src == keccak256("ui")) guard.setAsset(stock, ShareGuard.Source.UiMultiplier, 0);
        else if (src == keccak256("multiplier")) guard.setAsset(stock, ShareGuard.Source.Multiplier, 0);
        else guard.setAsset(stock, ShareGuard.Source.Feed, vm.parseUint(json.readString(".multiplier")));

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
            console2.log("FINDING: route ran but no stock reached the expected address (output sent elsewhere?)");
        } else if (sel == ShareGuard.RouterCallFailed.selector) {
            console2.log("FINDING: aggregator router reverted; inner revert data:");
        } else if (sel == ShareGuard.InsufficientShares.selector) {
            console2.log("FINDING: filled, but below the share-denominated minimum");
        } else if (sel == BatchExecutor.CallFailed.selector) {
            console2.log("FINDING: a batch call failed (index 1 = swap, 2 = share check):");
        } else if (sel == ShareGuard.TokenCallFailed.selector) {
            console2.log("FINDING: a token transfer/approve failed (compliance hook or allowance?)");
        }
        console2.logBytes(reason);
    }

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

    /// B. ShareGuard as the trader, with calldata the API built for the guard's address.
    ///    This is where RFQ legs bound to a taker, or routers that reject contracts, would fail.
    function test_B_guardWrapped() public {
        Leg memory l = _load(".guard");
        uint256 minShares = guard.toShares(stock, l.minReceive);
        uint256 before = _bal(TEST_USER);
        vm.startPrank(TEST_USER, TEST_USER);
        IERC20(usdt).approve(GUARD, amountIn);
        try guard.swapForShares(usdt, amountIn, l.approveTarget, l.router, l.data, stock, minShares, TEST_USER)
        returns (uint256 shares) {
            console2.log("guard shares", shares);
        } catch (bytes memory reason) {
            _explain(reason);
            fail();
        }
        vm.stopPrank();
        _report(_bal(TEST_USER) - before);
        assertEq(_bal(GUARD), 0, "guard kept stock");
    }

    /// C. ShareGuard refuses a fill below a share-denominated minimum (asks for 2x the quote).
    function test_C_guardRejectsShortfall() public {
        Leg memory l = _load(".guard");
        uint256 minShares = guard.toShares(stock, l.quoted) * 2;
        vm.startPrank(TEST_USER, TEST_USER);
        IERC20(usdt).approve(GUARD, amountIn);
        vm.expectPartialRevert(ShareGuard.InsufficientShares.selector);
        guard.swapForShares(usdt, amountIn, l.approveTarget, l.router, l.data, stock, minShares, TEST_USER);
        vm.stopPrank();
    }

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
            // index 1 = the swap itself failed (a replay problem, not a share-check result)
            assertEq(index, 2, "batch failed at the swap, not at the share check");
        }
        assertEq(IERC20(usdt).balanceOf(TEST_USER), amountIn, "USDT must be untouched after revert");
    }

    /// F. Does the route fit in the gas limit the API itself returns? On 2026-10-01 a live
    ///    NVDAon swap sent with the API's gas=450000 reverted (FailedInnerCall) and needed ~1.03M.
    ///    Forge doesn't cap gas, so A-E can pass while the real transaction would run out.
    function test_F_fitsApiGasLimit() public {
        Leg memory l = _load(".eoa");
        // a transaction's limit also pays intrinsic cost: 21000 + calldata (~16 gas per byte, upper bound)
        uint256 intrinsic = 21_000 + 16 * l.data.length;
        uint256 budget = l.apiGas > intrinsic ? l.apiGas - intrinsic : 0;
        vm.startPrank(TEST_USER, TEST_USER);
        IERC20(usdt).approve(l.approveTarget, amountIn);
        uint256 g0 = gasleft();
        (bool okUnlimited,) = l.router.call{value: l.value}(l.data);
        uint256 used = g0 - gasleft();
        vm.stopPrank();
        console2.log("API gas", l.apiGas);
        console2.log("gas the route used (approx.)", used + intrinsic);
        assertTrue(okUnlimited, "route failed even without a gas cap; see test A");
        if (used > budget) {
            console2.log("FINDING: the API's gas limit is too low for this route; a real tx would revert");
        }
        assertLe(used, budget, "API gas limit too low for this route");
    }
}
