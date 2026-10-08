// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ShareGuard} from "../src/ShareGuard.sol";

/// Owner-only additions to the existing ShareGuard; never deploys or reads a key.
/// preview() uses old recorded multipliers exclusively in local simulation, with
/// their timestamp printed. run() requires fresh owner seeds for new Ondo assets.
contract AddAssets is Script {
    using stdJson for string;

    address public constant DEPLOYED_GUARD = 0x28F6F19bffbF25E36452c78d12090F0bC922970a;
    uint256 internal constant MAX_SEED_AGE = 2 hours;
    uint16 internal constant ONDO_MAX_STEP_BPS = 300;
    bytes32 internal constant APPROVED_SYMBOLS = keccak256(
        "SPCXB|BABAB|GOOGLB|SKHYB|MSTRB|CRCLB|SNDKB|HOODB|MSFTB|INTCB|METAB|TSMB|SPCXon|GMEon|GOOGLon|CRCLon|AMZNon|BMNRon|TSMon|NFLXon|"
    );
    bytes32 internal constant BSTOCK_BATCH2_MANIFEST_HASH =
        0x019035a2067432e11788612676b092ce29882e50c7628db938ffa0b3a65720be;

    struct PlannedAsset {
        address stock;
        string symbol;
        ShareGuard.Asset config;
        uint256 seedMultiplier;
        bool skip;
    }

    /// Key-less local simulation of all 20 additions, without reading seeds.json.
    /// There is deliberately no startBroadcast on this path.
    function preview() external {
        ShareGuard guard = _guard();
        string memory assets = _loadAssets();
        string memory recorded = vm.readFile("captures/depth/batch-1-onchain.json");
        console2.log("SIMULATION ONLY: recorded Ondo multipliers; owner seeds remain pending");
        console2.log("recorded multiplier time (unix)", recorded.readUint(".observedAtUnix"));
        console2.log("simulation block time (unix)", block.timestamp);
        PlannedAsset[] memory plan = _plan(guard, assets, "", recorded, 0, 20);
        vm.startPrank(guard.owner());
        uint256 added = _apply(guard, plan);
        vm.stopPrank();
        console2.log("simulated additions", added);
        console2.log("No seed file generated, no transaction broadcast");
    }

    /// Forge supplies the owner's signing account externally. No key env read.
    /// Default is the first ten additions; runBatch selects explicit indices.
    function run() external {
        _run(0, 10);
    }

    function runBatch(uint256 start, uint256 size) external {
        _run(start, size);
    }

    function _run(uint256 start, uint256 size) internal {
        ShareGuard guard = _guard();
        string memory assets = _loadAssets();
        require(size > 0 && size <= 10 && start < 20 && size <= 20 - start, "invalid owner batch");
        string memory seeds;
        // The bStock-only batch and already-configured Ondo need no seed file.
        for (uint256 i = start; i < start + size; i++) {
            address stock = assets.readAddress(_key("assets", i, "address"));
            if (
                guard.assetOf(stock).source == ShareGuard.Source.None
                    && keccak256(bytes(assets.readString(_key("assets", i, "kind")))) == keccak256("ondo")
            ) {
                seeds = vm.readFile("deploy/seeds.json");
                break;
            }
        }
        PlannedAsset[] memory plan = _plan(guard, assets, seeds, "", start, size);
        vm.startBroadcast(guard.owner());
        uint256 added = _apply(guard, plan);
        vm.stopBroadcast();
        console2.log("configured additions", added);
    }

    /// Preserves the deployed configuration and feed; only enabled becomes false.
    function rollback(address stock) external {
        ShareGuard guard = _guard();
        string memory assets = _loadAssets();
        bool inScope;
        for (uint256 i; i < 20; i++) {
            if (assets.readAddress(_key("assets", i, "address")) == stock) inScope = true;
        }
        require(inScope, "rollback outside approved additions");
        ShareGuard.Asset memory cfg = guard.assetOf(stock);
        require(cfg.source != ShareGuard.Source.None, "asset was never configured");
        cfg.enabled = false;
        vm.startBroadcast(guard.owner());
        guard.setAsset(stock, cfg, 0);
        vm.stopBroadcast();
        console2.log("disabled asset", stock);
    }

    /// Separate, pinned bStock-only scope. Never reads seeds or a signing key.
    function previewBstockBatch2() external {
        ShareGuard guard = _guard();
        string memory assets = _loadBstockBatch2();
        PlannedAsset[] memory plan = _plan(guard, assets, "", "", 0, 6);
        vm.startPrank(guard.owner());
        uint256 added = _apply(guard, plan);
        vm.stopPrank();
        console2.log("Batch 2 simulated bStock additions", added);
        console2.log("No seeds, no signing, no transaction broadcast");
        _verifyBstockBatch2(guard, assets);
    }

    function runBstockBatch2() external {
        ShareGuard guard = _guard();
        string memory assets = _loadBstockBatch2();
        PlannedAsset[] memory plan = _plan(guard, assets, "", "", 0, 6);
        vm.startBroadcast(guard.owner());
        uint256 added = _apply(guard, plan);
        vm.stopBroadcast();
        console2.log("Batch 2 configured bStock additions", added);
        _verifyBstockBatch2(guard, assets);
    }

    function verifyBstockBatch2() external view {
        _verifyBstockBatch2(_guard(), _loadBstockBatch2());
    }

    function rollbackBstockBatch2(address stock) external {
        ShareGuard guard = _guard();
        string memory assets = _loadBstockBatch2();
        bool inScope;
        for (uint256 i; i < 6; i++) {
            if (assets.readAddress(_key("assets", i, "address")) == stock) inScope = true;
        }
        require(inScope, "rollback outside Batch 2");
        ShareGuard.Asset memory cfg = guard.assetOf(stock);
        require(cfg.source != ShareGuard.Source.None, "asset was never configured");
        cfg.enabled = false;
        vm.startBroadcast(guard.owner());
        guard.setAsset(stock, cfg, 0);
        vm.stopBroadcast();
        console2.log("Batch 2 disabled asset", stock);
    }

    function _loadBstockBatch2() internal view returns (string memory assets) {
        assets = vm.readFile("captures/depth/batch-2-bstock-manifest.json");
        _validateBstockBatch2(assets);
        for (uint256 i; i < 6; i++) {
            _verifyFilePin(
                assets,
                string.concat(_key("assets", i, "capture"), ".path"),
                string.concat(_key("assets", i, "capture"), ".sha256")
            );
        }
        for (uint256 i; i < 3; i++) {
            string memory field = i == 0 ? ".baseline" : i == 1 ? ".selection" : ".forkReport";
            _verifyFilePin(assets, string.concat(field, ".path"), string.concat(field, ".sha256"));
        }
    }

    function _validateBstockBatch2(string memory assets) internal view {
        require(keccak256(bytes(assets)) == BSTOCK_BATCH2_MANIFEST_HASH, "Batch 2 manifest bytes differ");
        require(assets.readUint(".count") == 6 && !assets.readBool(".needsSeeds"), "invalid Batch 2 scope");
        require(!vm.keyExistsJson(assets, _key("assets", 6, "address")), "extra Batch 2 asset");
        for (uint256 i; i < 6; i++) {
            require(
                keccak256(bytes(assets.readString(_key("assets", i, "kind")))) == keccak256("bstock"),
                "Batch 2 must be bStock only"
            );
        }
    }

    function _verifyFilePin(string memory assets, string memory pathKey, string memory hashKey) internal view {
        bytes32 expected = vm.parseBytes32(assets.readString(hashKey));
        require(sha256(bytes(vm.readFile(assets.readString(pathKey)))) == expected, "Batch 2 evidence bytes differ");
    }

    function _verifyBstockBatch2(ShareGuard guard, string memory assets) internal view {
        require(!guard.paused(), "ShareGuard paused");
        for (uint256 i; i < 6; i++) {
            address stock = assets.readAddress(_key("assets", i, "address"));
            ShareGuard.Asset memory cfg = guard.assetOf(stock);
            require(
                cfg.source == ShareGuard.Source.UiMultiplier && cfg.enabled && cfg.maxStepBps == 0
                    && cfg.pauseCheck == ShareGuard.PauseCheck.Manager
                    && cfg.pauseManager == assets.readAddress(".bstockPauseManager"),
                "Batch 2 configuration mismatch"
            );
            require(guard.sharesPerToken(stock) > 0 && !guard.isTokenPaused(stock), "Batch 2 issuer unavailable");
        }
        console2.log("Batch 2 verification passed: all six enabled with exact bStock configuration");
    }

    function _guard() internal view returns (ShareGuard guard) {
        require(block.chainid == 56, "BSC chain 56 required");
        require(DEPLOYED_GUARD.code.length > 0, "deployed ShareGuard unavailable");
        guard = ShareGuard(DEPLOYED_GUARD);
        console2.log("existing ShareGuard", DEPLOYED_GUARD);
        console2.log("owner", guard.owner());
        console2.log("block", block.number);
        console2.log("global pause", guard.paused());
    }

    function _key(string memory list, uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".", list, "[", vm.toString(i), "].", field);
    }

    function _loadAssets() internal view returns (string memory assets) {
        assets = vm.readFile("deploy/assets.json");
        require(assets.readUint(".count") == 20, "exactly 20 additions required");
        require(!vm.keyExistsJson(assets, _key("assets", 20, "address")), "extra addition");
        string memory fixedBatch = vm.readFile("deploy/batch-1.json");
        string memory symbols;
        for (uint256 i; i < 20; i++) {
            string memory symbol = assets.readString(_key("assets", i, "symbol"));
            symbols = string.concat(symbols, symbol, "|");
            bool matched;
            for (uint256 j; j < 53; j++) {
                if (keccak256(bytes(symbol)) != keccak256(bytes(fixedBatch.readString(_key("tokens", j, "symbol"))))) {
                    continue;
                }
                require(!fixedBatch.readBool(_key("tokens", j, "held")), "held token");
                require(
                    keccak256(bytes(fixedBatch.readString(_key("tokens", j, "role")))) == keccak256("candidate"),
                    "control token"
                );
                require(
                    assets.readAddress(_key("assets", i, "address"))
                            == fixedBatch.readAddress(_key("tokens", j, "address"))
                        && keccak256(bytes(assets.readString(_key("assets", i, "kind"))))
                            == keccak256(bytes(fixedBatch.readString(_key("tokens", j, "kind")))),
                    "fixed token identity differs"
                );
                matched = true;
                break;
            }
            require(matched, "unknown token");
        }
        require(keccak256(bytes(symbols)) == APPROVED_SYMBOLS, "list differs from approved 20 additions");
        require(
            assets.readAddress(".bstockPauseManager") == fixedBatch.readAddress(".bstockPauseManager"),
            "shared pause manager differs"
        );
    }

    function _plan(
        ShareGuard guard,
        string memory assets,
        string memory seeds,
        string memory recorded,
        uint256 start,
        uint256 size
    ) internal view returns (PlannedAsset[] memory plan) {
        plan = new PlannedAsset[](size);
        for (uint256 i; i < size; i++) {
            uint256 index = start + i;
            PlannedAsset memory p;
            p.stock = assets.readAddress(_key("assets", index, "address"));
            p.symbol = assets.readString(_key("assets", index, "symbol"));
            p.skip = guard.assetOf(p.stock).source != ShareGuard.Source.None;
            if (p.skip) {
                console2.log(p.symbol, "SKIP: source already configured (including disabled assets)");
            } else {
                require(p.stock.code.length > 0, "token code unavailable");
                bytes32 kind = keccak256(bytes(assets.readString(_key("assets", index, "kind"))));
                if (kind == keccak256("bstock")) {
                    p.config = ShareGuard.Asset(
                        ShareGuard.Source.UiMultiplier,
                        true,
                        0,
                        ShareGuard.PauseCheck.Manager,
                        assets.readAddress(".bstockPauseManager")
                    );
                } else {
                    require(kind == keccak256("ondo"), "unknown issuer");
                    p.config = ShareGuard.Asset(
                        ShareGuard.Source.Feed, true, ONDO_MAX_STEP_BPS, ShareGuard.PauseCheck.Manager, address(0)
                    );
                    p.seedMultiplier = bytes(recorded).length > 0
                        ? _recordedMultiplier(recorded, p.stock, p.symbol)
                        : _freshSeed(seeds, p.symbol);
                }
                console2.log(p.symbol, "ADD", p.stock);
                console2.log("  seed multiplier (1e18; zero for bStock)", p.seedMultiplier);
            }
            plan[i] = p;
        }
    }

    function _freshSeed(string memory seeds, string memory symbol) internal view returns (uint256 multiplier) {
        require(bytes(seeds).length > 0, "fresh owner seeds required");
        uint256 fetchedAt = seeds.readUint(".fetchedAtUnix");
        require(
            block.timestamp >= fetchedAt && block.timestamp - fetchedAt <= MAX_SEED_AGE, "owner seeds stale or future"
        );
        string memory key = string.concat(".seeds.", symbol, ".multiplier");
        require(vm.keyExistsJson(seeds, key), string.concat("no owner seed for ", symbol));
        multiplier = vm.parseUint(seeds.readString(key));
        require(multiplier > 0, "zero seed");
    }

    function _recordedMultiplier(string memory recorded, address stock, string memory symbol)
        internal
        pure
        returns (uint256 multiplier)
    {
        for (uint256 j; j < 53; j++) {
            if (recorded.readAddress(_key("tokens", j, "address")) == stock) {
                require(recorded.readBool(_key("tokens", j, "factsPass")), "recorded facts failed");
                require(
                    keccak256(bytes(recorded.readString(_key("tokens", j, "symbol")))) == keccak256(bytes(symbol)),
                    "recorded token identity differs"
                );
                multiplier = vm.parseUint(recorded.readString(_key("tokens", j, "multiplierE18")));
                require(multiplier > 0, "recorded multiplier unavailable");
                return multiplier;
            }
        }
        revert("recorded multiplier absent");
    }

    function _apply(ShareGuard guard, PlannedAsset[] memory plan) internal returns (uint256 added) {
        for (uint256 i; i < plan.length; i++) {
            PlannedAsset memory p = plan[i];
            if (p.skip) continue;
            uint256 before = gasleft();
            guard.setAsset(p.stock, p.config, p.seedMultiplier);
            uint256 used = before - gasleft();
            console2.log(p.symbol, "local setAsset gas (excludes intrinsic)", used);
            uint256 multiplier = guard.sharesPerToken(p.stock);
            require(multiplier > 0, "configured multiplier unavailable");
            console2.log("  shares per token (1e18)", multiplier);
            console2.log("  issuer paused now", guard.isTokenPaused(p.stock));
            added++;
        }
    }
}
