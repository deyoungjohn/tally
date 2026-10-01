// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal ERC-20 with an optional bStock-style uiMultiplier().
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public uiMultiplier = 1e18;

    function setUiMultiplier(uint256 m) external {
        uiMultiplier = m;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address s, uint256 amt) external returns (bool) {
        allowance[msg.sender][s] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/// Stands in for the aggregator router: pulls `spend` of tokenIn from the caller and sends
/// `out` of stock to `recipient` (which the real API bakes into calldata as userWalletAddress).
contract MockRouter {
    function swap(MockToken tokenIn, uint256 spend, MockToken stock, uint256 out, address recipient) external {
        tokenIn.transferFrom(msg.sender, address(this), spend);
        stock.mint(recipient, out);
    }
}
