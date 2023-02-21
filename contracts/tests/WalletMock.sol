// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";

contract WalletMock {
    address public immutable target;
    address public immutable token;
    address public immutable manager;
    bool public immutable isInitialized;
    bool public immutable isAccepted;

    constructor(
        address _target,
        address _token,
        address _manager,
        bool _isInitialized,
        bool _isAccepted
    ) {
        target = _target;
        token = _token;
        manager = _manager;
        isInitialized = _isInitialized;
        isAccepted = _isAccepted;
    }

    fallback() external payable {
        // Call function with data
        Address.functionCall(target, msg.data);
    }

    receive() external payable {}
}
