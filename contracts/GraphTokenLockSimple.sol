// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "./GraphTokenLock.sol";

/**
 * @title GraphTokenLockSimple
 * @notice This contract is the concrete simple implementation built on top of the base
 * GraphTokenLock functionality for use when we only need the token lock schedule
 * features but no interaction with the network.
 */
contract GraphTokenLockSimple is GraphTokenLock {
    // Initializer
    function initialize(
        address _owner,
        address _beneficiary,
        address _token,
        uint256 _managedAmount,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _periods,
        uint256 _releaseStartTime,
        bool _revocable
    ) external {
        _initialize(
            _owner,
            _beneficiary,
            _token,
            _managedAmount,
            _startTime,
            _endTime,
            _periods,
            _releaseStartTime,
            _revocable
        );
    }
}
