// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import { ITokenGateway } from "./arbitrum/ITokenGateway.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { L2GraphTokenLockManager } from "./L2GraphTokenLockManager.sol";
import { GraphTokenLockWallet } from "./GraphTokenLockWallet.sol";
import { MinimalProxyFactory } from "./MinimalProxyFactory.sol";
import { IGraphTokenLock } from "./IGraphTokenLock.sol";
import { Ownable as OZOwnable } from "@openzeppelin/contracts/access/Ownable.sol";

contract GraphTokenLockMigrator is MinimalProxyFactory {

    IERC20 public immutable graphToken;
    address public immutable l2Implementation;
    ITokenGateway public immutable l1Gateway;
    /// L1 GraphTokenLockManager => L2GraphTokenLockManager
    mapping(address => address) public l2LockManager;
    mapping(address => address) public migratedWalletAddress;

    constructor(
        IERC20 _graphToken,
        address _l2Implementation,
        ITokenGateway _l1Gateway
    ) OZOwnable() {
        graphToken = _graphToken;
        l2Implementation = _l2Implementation;
        l1Gateway = _l1Gateway;
    }

    function migrateGraphTokenLockWalletToL2(
        uint256 _maxGas,
        uint256 _gasPriceBid,
        uint256 _maxSubmissionCost
    ) external {
        require(migratedWalletAddress[msg.sender] == address(0), "ALREADY_MIGRATED");
        // Check that msg.sender is a GraphTokenLockWallet
        // That uses GRT and has a corresponding manager set in L2.
        GraphTokenLockWallet wallet = GraphTokenLockWallet(msg.sender);
        require(wallet.token() == graphToken, "INVALID_TOKEN");
        address l1Manager = address(wallet.manager());
        address l2Manager = l2LockManager[l1Manager];
        require(l2Manager != address(0), "INVALID_MANAGER");
        require(wallet.isAccepted(), "!ACCEPTED");
        require(wallet.isInitialized(), "!INITIALIZED");
        require(!wallet.isRevoked(), "REVOKED");

        // Extract all the storage variables from the GraphTokenLockWallet
        L2GraphTokenLockManager.MigratedWalletData memory data = L2GraphTokenLockManager.MigratedWalletData({
            owner: wallet.owner(),
            beneficiary: wallet.beneficiary(),
            managedAmount: wallet.managedAmount(),
            startTime: wallet.startTime(),
            endTime: wallet.endTime(),
            periods: wallet.periods(),
            releaseStartTime: wallet.releaseStartTime(),
            vestingCliffTime: wallet.vestingCliffTime(),
            revocable: wallet.revocable() == IGraphTokenLock.Revocability.Enabled,
            releasedAmount: wallet.releasedAmount(),
            usedAmount: wallet.usedAmount()
        });
        // Build the encoded message for L2
        bytes memory encodedData = abi.encode(data);
        migratedWalletAddress[msg.sender] = getDeploymentAddress(keccak256(encodedData), l2Implementation);
        // Pull all the tokens from the GraphTokenLockWallet
        uint256 amount = graphToken.balanceOf(msg.sender);
        graphToken.transferFrom(msg.sender, address(this), amount);
    
        // Send the tokens with a message through the L1GraphTokenGateway to the L2GraphTokenLockManager
        graphToken.approve(address(l1Gateway), amount);
        bytes memory transferData = abi.encode(_maxSubmissionCost, encodedData);
        l1Gateway.outboundTransfer(
            address(graphToken),
            l2Manager,
            amount,
            _maxGas,
            _gasPriceBid,
            transferData
        );
    }
}
