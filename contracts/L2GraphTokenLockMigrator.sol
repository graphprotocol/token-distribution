// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { L2GraphTokenLockManager } from "./L2GraphTokenLockManager.sol";
import { L2GraphTokenLockWallet } from "./L2GraphTokenLockWallet.sol";
import { IGraphTokenLock } from "./IGraphTokenLock.sol";
import { ITokenGateway } from "./arbitrum/ITokenGateway.sol";

/**
 * @title L2GraphTokenLockMigrator
 */
contract L2GraphTokenLockMigrator {

    IERC20 public immutable graphToken;
    ITokenGateway public immutable l2Gateway;

    /**
     * Constructor.
     * @param _graphToken Token to use for deposits and withdrawals
     * @param _l2Gateway L2GraphTokenGateway
     */
    constructor(IERC20 _graphToken, ITokenGateway _l2Gateway) {
        graphToken = _graphToken;
        l2Gateway = _l2Gateway;
    }

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
        return l2Gateway.outboundTransfer(address(graphToken), l1Wallet, _amount, 0, 0, "0x");
    }
}
