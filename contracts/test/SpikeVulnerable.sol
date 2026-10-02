// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
}

/// TEST-ONLY. The swap logic of spike/shareguard/src/ShareGuard.sol, trimmed to what the
/// arbitrary-call attack needs, so fork test G can show the hole is real on mainnet state and
/// that ShareGuard v1 closes it. NEVER deploy this or the spike contract.
contract SpikeVulnerable {
    mapping(address => uint256) public multiplierOf; // stock => shares per token (owner-set, 1e18)

    function setMultiplier(address stock, uint256 m) external {
        multiplierOf[stock] = m;
    }

    function swapForShares(
        address tokenIn,
        uint256 amountIn,
        address approveTarget,
        address router,
        bytes calldata data,
        address stock,
        uint256 minShares,
        address recipient
    ) external returns (uint256 shares) {
        uint256 stockBefore = IERC20Min(stock).balanceOf(address(this));
        _call(tokenIn, abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amountIn)); // transferFrom
        _call(tokenIn, abi.encodeWithSelector(0x095ea7b3, approveTarget, amountIn)); // approve
        (bool ok,) = router.call(data); // <-- ANY router, ANY data
        require(ok, "router failed");
        uint256 out = IERC20Min(stock).balanceOf(address(this)) - stockBefore;
        require(out != 0, "no output");
        shares = out * multiplierOf[stock] / 1e18;
        require(shares >= minShares, "min shares");
        _call(stock, abi.encodeWithSelector(0xa9059cbb, recipient, out)); // transfer
    }

    function _call(address token, bytes memory payload) private {
        (bool ok, bytes memory ret) = token.call(payload);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "token call failed");
    }
}
