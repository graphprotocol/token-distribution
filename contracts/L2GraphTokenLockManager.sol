// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import { ICallhookReceiver } from "./ICallhookReceiver.sol";
import { GraphTokenLockManager } from "./GraphTokenLockManager.sol";
import { IGraphTokenLock } from "./IGraphTokenLock.sol";

/**
 * @title L2GraphTokenLockManager
 * @notice This contract manages a list of authorized function calls and targets that can be called
 * by any TokenLockWallet contract and it is a factory of TokenLockWallet contracts.
 *
 * This contract receives funds to make the process of creating TokenLockWallet contracts
 * easier by distributing them the initial tokens to be managed.
 *
 * The owner can setup a list of token destinations that will be used by TokenLock contracts to
 * approve the pulling of funds, this way in can be guaranteed that only protocol contracts
 * will manipulate users funds.
 */
contract L2GraphTokenLockManager is GraphTokenLockManager, ICallhookReceiver {
    using SafeERC20 for IERC20;

    struct MigratedWalletData {
        address l1Address;
        address owner;
        address beneficiary;
        uint256 managedAmount;
        uint256 startTime;
        uint256 endTime;
    }

    address public immutable l2Gateway;
    address public immutable l1Migrator;
    /// L1 address => L2 address
    mapping(address => address) public l1WalletToL2Wallet;
    /// L2 address => L1 address
    mapping(address => address) public l2WalletToL1Wallet;

    event TokenLockCreatedFromL1(
        address indexed contractAddress,
        bytes32 initHash,
        address indexed beneficiary,
        uint256 managedAmount,
        uint256 startTime,
        uint256 endTime,
        address indexed l1Address
    );

    event LockedTokensReceivedFromL1(address indexed l1Address, address indexed l2Address, uint256 amount);

    /**
     * @dev Checks that the sender is the L2GraphTokenGateway.
     */
    modifier onlyL2Gateway() {
        require(msg.sender == l2Gateway, "ONLY_GATEWAY");
        _;
    }

    /**
     * Constructor.
     * @param _graphToken Token to use for deposits and withdrawals
     * @param _masterCopy Address of the master copy to use to clone proxies
     */
    constructor(
        IERC20 _graphToken,
        address _masterCopy,
        address _l2Gateway,
        address _l1Migrator
    ) GraphTokenLockManager(_graphToken, _masterCopy) {
        l2Gateway = _l2Gateway;
        l1Migrator = _l1Migrator;
    }

    function onTokenTransfer(
        address _from,
        uint256 _amount,
        bytes calldata _data
    ) external override onlyL2Gateway {
        require(_from == l1Migrator, "ONLY_MIGRATOR");
        MigratedWalletData memory walletData = abi.decode(_data, (MigratedWalletData));

        if (l1WalletToL2Wallet[walletData.l1Address] != address(0)) {
            // If the wallet was already migrated, just send the tokens to the L2 address
            _token.safeTransfer(l1WalletToL2Wallet[walletData.l1Address], _amount);
        } else {
            // Create contract using a minimal proxy and call initializer
            (bytes32 initHash, address contractAddress) = _deployFromL1(keccak256(_data), walletData);
            l1WalletToL2Wallet[walletData.l1Address] = contractAddress;
            l2WalletToL1Wallet[contractAddress] = walletData.l1Address;

            // Send managed amount to the created contract
            _token.safeTransfer(contractAddress, _amount);

            emit TokenLockCreatedFromL1(
                contractAddress,
                initHash,
                walletData.beneficiary,
                walletData.managedAmount,
                walletData.startTime,
                walletData.endTime,
                walletData.l1Address
            );
        }
        emit LockedTokensReceivedFromL1(walletData.l1Address, l1WalletToL2Wallet[walletData.l1Address], _amount);
    }

    function _deployFromL1(bytes32 _salt, MigratedWalletData memory _walletData) internal returns (bytes32, address) {
        bytes memory initializer = _encodeInitializer(_walletData);
        address contractAddress = _deployProxy2(_salt, masterCopy, initializer);
        return (keccak256(initializer), contractAddress);
    }

    function _encodeInitializer(MigratedWalletData memory _walletData) internal view returns (bytes memory) {
        return
            abi.encodeWithSignature(
                "initializeFromL1(address,address,(address,address,address,uint256,uint256,uint256)))",
                address(this),
                address(_token),
                _walletData
            );
    }
}
