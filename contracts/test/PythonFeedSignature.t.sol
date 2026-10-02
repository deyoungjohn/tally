// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ShareGuard} from "../src/ShareGuard.sol";

/// The EIP-712 FeedUpdate that tools/guarded_buy.py signs (eth_account) must verify against this
/// contract's own digest, on the chain id and verifying-contract address the tool uses. The
/// vector was produced by sign_feed_update() with the public test constant 0xFEED5 (the same test
/// key the fork tests use for the feed signer): never a real key.
contract PythonFeedSignatureTest is Test {
    address constant GUARD = 0xcb634955B8A7DF7B106f7AB47C9759B26206b777;
    address constant NVDAON = 0xA9eE28C80f960B889dFbd1902055218cBa016F75;
    address constant PY_SIGNER = 0x4631066a389C2B17b6e9311A6fB900ace0cD4733;
    bytes constant PY_SIG =
        hex"0972046a9e745bd259e5877fe75899c2e135ecf5a85ec7392193a57cdd30dc363493a433687e607c0ea11394e89684e9b7337c254d88d489f23256beab337f701c";

    function test_pythonSignedFeedUpdateVerifies() public {
        assertEq(vm.addr(0xFEED5), PY_SIGNER, "the vector's key is the test constant");
        vm.chainId(56);
        deployCodeTo("ShareGuard.sol:ShareGuard", abi.encode(address(this), PY_SIGNER), GUARD);
        ShareGuard.FeedUpdate memory u = ShareGuard.FeedUpdate(NVDAON, 1001715248795989800, 1790000000, 1790000930);
        bytes32 digest = ShareGuard(GUARD).feedUpdateDigest(u);
        assertEq(ECDSA.recover(digest, PY_SIG), PY_SIGNER, "python's EIP-712 signature != contract digest");
    }
}
