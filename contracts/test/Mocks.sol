// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Minimal ERC-20 with the optional issuer hooks ShareGuard reads.
contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public uiMultiplier = 1e18;
    uint256 public multiplier = 1e18;
    bool public isPaused;
    address public tokenPauseManager;

    function setUiMultiplier(uint256 m) external {
        uiMultiplier = m;
    }

    function setMultiplier(uint256 m) external {
        multiplier = m;
    }

    function setPaused(bool p) external {
        isPaused = p;
    }

    function setPauseManager(address m) external {
        tokenPauseManager = m;
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

/// Stands in for Ondo's / bStock's shared pause manager.
contract MockPauseManager {
    mapping(address => bool) public paused;
    bool public reverts;

    function setPaused(address token, bool p) external {
        paused[token] = p;
    }

    function setReverts(bool r) external {
        reverts = r;
    }

    function isTokenPaused(address token) external view returns (bool) {
        require(!reverts, "boom");
        return paused[token];
    }
}

/// Stands in for the aggregator router: pulls `spend` of tokenIn from the caller and sends
/// `out` of stock to `recipient` (which the real API bakes into calldata as userWalletAddress).
contract MockRouter {
    function swap(MockToken tokenIn, uint256 spend, MockToken stock, uint256 out, address recipient) external {
        tokenIn.transferFrom(msg.sender, address(this), spend);
        stock.mint(recipient, out);
    }

    function fail() external pure {
        revert("router says no");
    }
}

/// A router that tries to call back into the guard while it is mid-swap.
contract ReentrantRouter {
    address public guard;
    bytes public payload;

    function arm(address guard_, bytes calldata payload_) external {
        guard = guard_;
        payload = payload_;
    }

    function swap(MockToken tokenIn, uint256 spend, MockToken stock, uint256 out, address recipient) external {
        tokenIn.transferFrom(msg.sender, address(this), spend);
        stock.mint(recipient, out);
        (bool ok, bytes memory ret) = guard.call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
