// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ShareGuard} from "../src/ShareGuard.sol";

/// Owner-only addition of four Ondo tokens (INTCon, METAon, MSFTon, MSTRon) to the deployed ShareGuard, configured exactly like
/// the Ondo tokens already there (feed source, 300 bps step, pause read from the token's own manager). Never reads a key: forge
/// supplies the owner account. Needs deploy/seeds-batch3.json from tools/gen_ondo_seeds_batch3.py, at most two hours old.
contract AddOndoBatch3 is Script {
    using stdJson for string;

    address public constant DEPLOYED_GUARD = 0x28F6F19bffbF25E36452c78d12090F0bC922970a;
    uint256 internal constant MAX_SEED_AGE = 2 hours;
    uint16 internal constant ONDO_MAX_STEP_BPS = 300;
    uint256 internal constant COUNT = 4;

    /// Key-less simulation: pranks as the owner, broadcasts nothing.
    function preview() external {
        ShareGuard guard = _guard();
        (address[COUNT] memory stocks, string[COUNT] memory symbols, uint256[COUNT] memory seeds) = _plan();
        vm.startPrank(guard.owner());
        _apply(guard, stocks, symbols, seeds);
        vm.stopPrank();
        console2.log("No transaction broadcast");
    }

    function run() external {
        ShareGuard guard = _guard();
        (address[COUNT] memory stocks, string[COUNT] memory symbols, uint256[COUNT] memory seeds) = _plan();
        vm.startBroadcast(guard.owner());
        _apply(guard, stocks, symbols, seeds);
        vm.stopBroadcast();
    }

    /// Read-only: every one of the four is enabled with the exact Ondo configuration.
    function verify() external view {
        ShareGuard guard = _guard();
        (address[COUNT] memory stocks, string[COUNT] memory symbols,) = _identity();
        for (uint256 i; i < COUNT; i++) {
            ShareGuard.Asset memory cfg = guard.assetOf(stocks[i]);
            require(
                cfg.source == ShareGuard.Source.Feed && cfg.enabled && cfg.maxStepBps == ONDO_MAX_STEP_BPS
                    && cfg.pauseCheck == ShareGuard.PauseCheck.Manager && cfg.pauseManager == address(0),
                string.concat(symbols[i], " configuration mismatch")
            );
            require(guard.sharesPerToken(stocks[i]) > 0, string.concat(symbols[i], " multiplier unavailable"));
            console2.log(symbols[i], "enabled; shares per token (1e18)", guard.sharesPerToken(stocks[i]));
        }
        console2.log("Batch 3 verification passed");
    }

    /// Disables one of the four again, keeping its configuration and feed.
    function rollback(address stock) external {
        ShareGuard guard = _guard();
        (address[COUNT] memory stocks,,) = _identity();
        bool inScope;
        for (uint256 i; i < COUNT; i++) {
            if (stocks[i] == stock) inScope = true;
        }
        require(inScope, "rollback outside Batch 3");
        ShareGuard.Asset memory cfg = guard.assetOf(stock);
        require(cfg.source != ShareGuard.Source.None, "asset was never configured");
        cfg.enabled = false;
        vm.startBroadcast(guard.owner());
        guard.setAsset(stock, cfg, 0);
        vm.stopBroadcast();
        console2.log("disabled asset", stock);
    }

    function _guard() internal view returns (ShareGuard guard) {
        require(block.chainid == 56, "BSC chain 56 required");
        require(DEPLOYED_GUARD.code.length > 0, "deployed ShareGuard unavailable");
        guard = ShareGuard(DEPLOYED_GUARD);
        console2.log("existing ShareGuard", DEPLOYED_GUARD);
        console2.log("owner", guard.owner());
        console2.log("global pause", guard.paused());
        require(!guard.paused(), "ShareGuard paused");
    }

    function _key(string memory list, uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".", list, "[", vm.toString(i), "].", field);
    }

    /// The four tokens, found by symbol in the fixed Batch 1 registry; each must be an Ondo candidate that is not held.
    function _identity()
        internal
        view
        returns (address[COUNT] memory stocks, string[COUNT] memory symbols, uint256[COUNT] memory seeds)
    {
        symbols = ["INTCon", "METAon", "MSFTon", "MSTRon"];
        string memory batch = vm.readFile("deploy/batch-1.json");
        for (uint256 i; i < COUNT; i++) {
            bool found;
            for (uint256 j; j < 53; j++) {
                if (keccak256(bytes(batch.readString(_key("tokens", j, "symbol")))) != keccak256(bytes(symbols[i]))) {
                    continue;
                }
                require(
                    keccak256(bytes(batch.readString(_key("tokens", j, "kind")))) == keccak256("ondo")
                        && !batch.readBool(_key("tokens", j, "held")),
                    "not an Ondo candidate"
                );
                stocks[i] = batch.readAddress(_key("tokens", j, "address"));
                require(stocks[i].code.length > 0, "token code unavailable");
                found = true;
                break;
            }
            require(found, "token not in Batch 1");
        }
        seeds;
    }

    function _plan()
        internal
        view
        returns (address[COUNT] memory stocks, string[COUNT] memory symbols, uint256[COUNT] memory seeds)
    {
        (stocks, symbols,) = _identity();
        string memory file = vm.readFile("deploy/seeds-batch3.json");
        uint256 fetchedAt = file.readUint(".fetchedAtUnix");
        require(
            block.timestamp >= fetchedAt && block.timestamp - fetchedAt <= MAX_SEED_AGE, "owner seeds stale or future"
        );
        for (uint256 i; i < COUNT; i++) {
            string memory key = string.concat(".seeds.", symbols[i], ".multiplier");
            require(vm.keyExistsJson(file, key), string.concat("no owner seed for ", symbols[i]));
            seeds[i] = vm.parseUint(file.readString(key));
            require(seeds[i] > 0, "zero seed");
        }
    }

    function _apply(
        ShareGuard guard,
        address[COUNT] memory stocks,
        string[COUNT] memory symbols,
        uint256[COUNT] memory seeds
    ) internal {
        for (uint256 i; i < COUNT; i++) {
            if (guard.assetOf(stocks[i]).source != ShareGuard.Source.None) {
                console2.log(symbols[i], "SKIP: source already configured (including disabled assets)");
                continue;
            }
            ShareGuard.Asset memory config = ShareGuard.Asset(
                ShareGuard.Source.Feed, true, ONDO_MAX_STEP_BPS, ShareGuard.PauseCheck.Manager, address(0)
            );
            console2.log(symbols[i], "ADD", stocks[i]);
            console2.log("  seed multiplier (1e18)", seeds[i]);
            guard.setAsset(stocks[i], config, seeds[i]);
            require(guard.sharesPerToken(stocks[i]) > 0, "configured multiplier unavailable");
            console2.log("  shares per token (1e18)", guard.sharesPerToken(stocks[i]));
            console2.log("  issuer paused now", guard.isTokenPaused(stocks[i]));
        }
    }
}
