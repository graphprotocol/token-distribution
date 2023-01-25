// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { GraphTokenLockWallet } from "./GraphTokenLockWallet.sol";
import { Ownable } from "./Ownable.sol";
import { L2GraphTokenLockManager } from "./L2GraphTokenLockManager.sol";

/**
 * @title L2GraphTokenLockWallet
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
contract L2GraphTokenLockWallet is GraphTokenLockWallet {
    // Initializer when created from a message from L1
    function initializeFromL1(
        address _manager,
        address _token,
        L2GraphTokenLockManager.MigratedWalletData calldata _walletData
    ) external {
        
        isInitialized = true;

        Ownable.initialize(_walletData.owner);
        beneficiary = _walletData.beneficiary;
        token = IERC20(_token);

        managedAmount = _walletData.managedAmount;

        startTime = _walletData.startTime;
        endTime = _walletData.endTime;
        periods = _walletData.periods;

        // Optionals
        releaseStartTime = _walletData.releaseStartTime;
        vestingCliffTime = _walletData.vestingCliffTime;
        if (_walletData.revocable) {
            revocable = Revocability.Enabled;
        } else {
            revocable = Revocability.Disabled;
        }
        releasedAmount = _walletData.releasedAmount;
        usedAmount = _walletData.usedAmount;

        _setManager(_manager);
    }

}
