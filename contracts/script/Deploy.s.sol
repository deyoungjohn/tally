// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ShareGuard} from "../src/ShareGuard.sol";

/// Deploys ShareGuard v1 to BSC and configures it from deploy/assets.json + deploy/seeds.json
/// (written by tools/gen_assets.py). Run it ON YOUR OWN MACHINE: it reads DEPLOYER_PK from the
/// environment and nothing else ever sees that key. Without DEPLOYER_PK it is a key-less
/// simulation (pass --sender <any address>), which is how CI and this repo's author check it.
///
///   Inputs (environment):
///     DEPLOYER_PK   0x-prefixed private key of the deployer (omit to simulate)
///     FEED_SIGNER   ADDRESS of the Ondo feed signer (never its key)
///     OWNER         optional; the owner after deployment (two-step: it must call acceptOwnership).
///                   Defaults to the deployer.
///
///   Dry run:   forge script script/Deploy.s.sol:Deploy --rpc-url $BSC_RPC --sender <addr> -vv
///   Deploy:    forge script script/Deploy.s.sol:Deploy --rpc-url $BSC_RPC --broadcast \
///                --verify --verifier etherscan --etherscan-api-key $BSCSCAN_API_KEY -vv
contract Deploy is Script {
    using stdJson for string;

    uint16 constant ONDO_MAX_STEP_BPS = 300; // blueprint §10.2: per asset, start 300 bps
    uint256 constant MAX_SEED_AGE = 2 hours; // seeds are the owner-vouched first Ondo value: keep them fresh

    function run() external returns (ShareGuard guard) {
        uint256 pk = vm.envOr("DEPLOYER_PK", uint256(0));
        address deployer = pk != 0 ? vm.addr(pk) : msg.sender;
        address owner_ = vm.envOr("OWNER", deployer);
        address feedSigner = vm.envAddress("FEED_SIGNER");
        require(feedSigner != address(0) && feedSigner != deployer, "FEED_SIGNER must be a separate, non-zero address");

        string memory assets = vm.readFile("deploy/assets.json");
        string memory seeds = vm.readFile("deploy/seeds.json");
        uint256 fetchedAt = seeds.readUint(".fetchedAtUnix");
        require(
            block.timestamp >= fetchedAt && block.timestamp - fetchedAt <= MAX_SEED_AGE,
            "seeds.json is stale: rerun tools/gen_assets.py"
        );
        address router = assets.readAddress(".router");
        address approveTarget = assets.readAddress(".approveTarget");
        address bstockPauseManager = assets.readAddress(".bstockPauseManager");
        uint256 n = assets.readUint(".count");
        require(n > 0, "no assets");
        require(vm.keyExistsJson(assets, _key(n - 1, "address")), "assets.json: count is larger than the list");
        require(!vm.keyExistsJson(assets, _key(n, "address")), "assets.json: count is smaller than the list");

        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        guard = new ShareGuard(deployer, feedSigner);
        guard.setRouter(router, true, approveTarget);
        for (uint256 i = 0; i < n; i++) {
            _configure(guard, assets, seeds, i, bstockPauseManager);
        }
        if (owner_ != deployer) guard.transferOwnership(owner_);
        vm.stopBroadcast();

        _verify(guard, assets, n);
        _summary(guard, router, owner_ != deployer, owner_);
    }

    /// Read-only checks against live chain state: every asset must price and answer its pause check.
    function _verify(ShareGuard guard, string memory assets, uint256 n) internal view {
        for (uint256 i = 0; i < n; i++) {
            address stock = assets.readAddress(_key(i, "address"));
            uint256 m = guard.sharesPerToken(stock);
            bool paused = guard.isTokenPaused(stock);
            require(m != 0, "multiplier unavailable");
            console2.log(assets.readString(_key(i, "symbol")), "shares per token (1e18):", m);
            if (paused) console2.log("  NOTE: the issuer reports this token as paused right now");
        }
    }

    function _summary(ShareGuard guard, address router, bool handOver, address newOwner) internal view {
        console2.log("ShareGuard deployed at", address(guard));
        console2.log("owner", guard.owner());
        console2.log("pending owner", guard.pendingOwner());
        console2.log("feed signer", guard.feedSigner());
        console2.log("router", router);
        if (handOver) console2.log("NEXT: the new owner must call acceptOwnership() from", newOwner);
    }

    function _key(uint256 i, string memory field) internal pure returns (string memory) {
        return string.concat(".assets[", vm.toString(i), "].", field);
    }

    function _configure(ShareGuard guard, string memory assets, string memory seeds, uint256 i, address bstockPm)
        internal
    {
        address stock = assets.readAddress(_key(i, "address"));
        string memory sym = assets.readString(_key(i, "symbol"));
        bytes32 kind = keccak256(bytes(assets.readString(_key(i, "kind"))));
        if (kind == keccak256("bstock")) {
            guard.setAsset(
                stock,
                ShareGuard.Asset(ShareGuard.Source.UiMultiplier, true, 0, ShareGuard.PauseCheck.Manager, bstockPm),
                0
            );
        } else if (kind == keccak256("ondo")) {
            string memory seedKey = string.concat(".seeds.", sym, ".multiplier");
            require(vm.keyExistsJson(seeds, string.concat(".seeds.", sym)), string.concat("no seed for ", sym));
            uint256 seed = vm.parseUint(seeds.readString(seedKey));
            guard.setAsset(
                stock,
                ShareGuard.Asset(
                    ShareGuard.Source.Feed, true, ONDO_MAX_STEP_BPS, ShareGuard.PauseCheck.Manager, address(0)
                ),
                seed
            );
        } else {
            revert(string.concat("unknown kind for ", sym));
        }
    }
}
