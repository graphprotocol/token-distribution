// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { L2GraphTokenLockManager } from "./L2GraphTokenLockManager.sol";
import { L2GraphTokenLockWallet } from "./L2GraphTokenLockWallet.sol";
import { IGraphTokenLock } from "./IGraphTokenLock.sol";
import { ITokenGateway } from "./arbitrum/ITokenGateway.sol";

/**
 * @title L2GraphTokenLockMigrator contract
 * @notice This contract is used to migrate GRT from L2 token lock wallets
 * back to their L1 counterparts.
 */
contract L2GraphTokenLockMigrator {
    /// Address of the L2 GRT token
    IERC20 public immutable graphToken;
    /// Address of the L2GraphTokenGateway
    ITokenGateway public immutable l2Gateway;
    /// Address of the L1 GRT token (in L1, no aliasing)
    address public immutable l1GraphToken;

    /**
     * @notice Constructor for the L2GraphTokenLockMigrator contract
     * @param _graphToken Address of the L2 GRT token
     * @param _l2Gateway Address of the L2GraphTokenGateway
     * @param _l1GraphToken Address of the L1 GRT token (in L1, no aliasing)
     */
    constructor(
        IERC20 _graphToken,
        ITokenGateway _l2Gateway,
        address _l1GraphToken
    ) {
        graphToken = _graphToken;
        l2Gateway = _l2Gateway;
        l1GraphToken = _l1GraphToken;
    }

    /**
     * @notice Withdraw GRT from an L2 token lock wallet to its L1 counterpart.
     * This function must be called from an L2GraphTokenLockWallet contract.
     * The GRT will be sent to L1 and must be claimed using the Arbitrum Outbox on L1
     * after the standard Arbitrum withdrawal period (7 days).
     * @param _amount Amount of GRT to withdraw
     * @return bytes The ID of the L2-L1 message returned by the L2GraphTokenGateway
     */
    function withdrawToL1Locked(uint256 _amount) external returns (bytes memory) {
        L2GraphTokenLockWallet wallet = L2GraphTokenLockWallet(msg.sender);
        L2GraphTokenLockManager manager = L2GraphTokenLockManager(address(wallet.manager()));
        require(address(manager) != address(0), "INVALID_SENDER");
        address l1Wallet = manager.l2WalletToL1Wallet(msg.sender);
        require(l1Wallet != address(0), "NOT_MIGRATED");
        require(_amount <= graphToken.balanceOf(msg.sender), "INSUFFICIENT_BALANCE");
        require(_amount != 0, "ZERO_AMOUNT");

        graphToken.transferFrom(msg.sender, address(this), _amount);
        // Send the tokens with a message through the L1GraphTokenGateway to the L2GraphTokenLockManager
        graphToken.approve(address(l2Gateway), _amount);
        return l2Gateway.outboundTransfer(l1GraphToken, l1Wallet, _amount, 0, 0, "");
    }
}
