// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BatchExecutor (spike, unaudited)
/// @notice Minimal EIP-7702 delegate: an EOA that delegates to this code can run several calls
///         atomically by calling execute() on itself. Only the EOA itself may call it.
contract BatchExecutor {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    error OnlySelf();
    error CallFailed(uint256 index, bytes reason);

    function execute(Call[] calldata calls) external payable {
        if (msg.sender != address(this)) revert OnlySelf();
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, ret);
        }
    }
}
