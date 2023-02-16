// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";

contract WalletWithWrongToken {
    address public constant token = 0x5c946740441C12510a167B447B7dE565C20b9E3C;
    address public immutable target;

    constructor(address _target) {
        target = _target;
    }

    fallback() external payable {
        // Call function with data
        Address.functionCall(target, msg.data);
    }

    receive() external payable {}
}
