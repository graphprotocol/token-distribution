// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./GraphTokenLock.sol";
import "./IGraphTokenLockManager.sol";

/**
 * @title GraphTokenLockWallet
 * @notice This contract is built on top of the base GraphTokenLock functionality.
 * It allows wallet beneficiaries to use the deposited funds to perform specific function calls
 * on specific contracts.
 *
 * The idea is that supporters with locked tokens can participate in the protocol
 * but disallow any release before the vesting/lock schedule.
 * The beneficiary can issue authorized function calls to this contract that will
 * get forwarded to a target contract. A target contract is any of our protocol contracts.
 * The function calls allowed are queried to the GraphTokenLockManager, this way
 * the same configuration can be shared for all the created lock wallet contracts.
 *
 * NOTE: Contracts used as target must have its function signatures checked to avoid collisions
 * with any of this contract functions.
 * Beneficiaries need to approve the use of the tokens to the protocol contracts. For convenience
 * the maximum amount of tokens is authorized.
 */
contract GraphTokenLockWallet is GraphTokenLock {
    using SafeERC20 for IERC20;

    // -- State --

    IGraphTokenLockManager public manager;

    uint256 private constant MAX_UINT256 = 2**256 - 1;

    // -- Events --

    event ManagerUpdated(address indexed _oldManager, address indexed _newManager);

    // Initializer
    function initialize(
        address _manager,
        address _owner,
        address _beneficiary,
        address _token,
        uint256 _managedAmount,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _periods,
        uint256 _releaseStartTime,
        Revocability _revocable
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
        _setManager(_manager);
    }

    // -- Admin --

    /**
     * @notice Sets a new manager for this contract
     * @param _newManager Address of the new manager
     */
    function setManager(address _newManager) external onlyOwner {
        _setManager(_newManager);
    }

    /**
     * @dev Sets a new manager for this contract
     * @param _newManager Address of the new manager
     */
    function _setManager(address _newManager) private {
        require(_newManager != address(0), "Manager cannot be empty");
        require(Address.isContract(_newManager), "Manager must be a contract");

        address oldManager = address(manager);
        manager = IGraphTokenLockManager(_newManager);

        emit ManagerUpdated(oldManager, _newManager);
    }

    // -- Beneficiary --

    /**
     * @notice Approves protocol access of the tokens managed by this contract
     * @dev Approves all token destinations registered in the manager to pull tokens
     */
    function approveProtocol() external onlyBeneficiary {
        address[] memory dstList = manager.getTokenDestinations();
        for (uint256 i = 0; i < dstList.length; i++) {
            token.safeApprove(dstList[i], MAX_UINT256);
        }
    }

    /**
     * @notice Revokes protocol access of the tokens managed by this contract
     * @dev Revokes approval to all token destinations in the manager to pull tokens
     */
    function revokeProtocol() external onlyBeneficiary {
        address[] memory dstList = manager.getTokenDestinations();
        for (uint256 i = 0; i < dstList.length; i++) {
            token.safeApprove(dstList[i], 0);
        }
    }

    /**
     * @notice Forward authorized contract calls to protocol contracts
     * @dev Fallback function can be called by the beneficiary only if function call is allowed
     */
    fallback() external payable {
        // Only beneficiary can forward calls
        require(msg.sender == beneficiary, "Unauthorized caller");

        // Function call validation
        address _target = manager.getAuthFunctionCallTarget(msg.sig);
        require(_target != address(0), "Unauthorized function");

        // Call function with data
        Address.functionCall(_target, msg.data);
    }
}
