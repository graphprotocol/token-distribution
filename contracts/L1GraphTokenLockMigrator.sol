// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ITokenGateway } from "./arbitrum/ITokenGateway.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { L2GraphTokenLockManager } from "./L2GraphTokenLockManager.sol";
import { GraphTokenLockWallet } from "./GraphTokenLockWallet.sol";
import { MinimalProxyFactory } from "./MinimalProxyFactory.sol";
import { IGraphTokenLock } from "./IGraphTokenLock.sol";
import { Ownable as OZOwnable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title L1GraphTokenLockMigrator contract
 * @notice This contract is used to migrate GRT from GraphTokenLockWallets
 * to a counterpart on L2. It is deployed on L1 and will send the GRT through
 * the L1GraphTokenGateway with a callhook to the L2GraphTokenLockManager, including
 * data to create a L2GraphTokenLockWallet on L2.
 *
 * Note that the L2GraphTokenLockWallet will not allow releasing any GRT until the end of
 * the vesting timeline, but will allow sending the GRT back to the L1 wallet.
 *
 * Beneficiaries for a GraphTokenLockWallet can perform the depositToL2Locked call
 * as many times as they want, and the GRT will be sent to the same L2GraphTokenLockWallet.
 *
 * Since all retryable tickets to send transactions to L2 require ETH for gas, this
 * contract also allows users to deposit ETH to be used for gas on L2, both for
 * the depositToL2Locked calls and for the migration helpers in the Staking contract for
 * The Graph.
 *
 * See GIP-0046 for more details: https://forum.thegraph.com/t/gip-0046-l2-migration-helpers/4023
 */
contract L1GraphTokenLockMigrator is MinimalProxyFactory {
    using SafeMath for uint256;

    /// Address of the L1 GRT token contract
    IERC20 public immutable graphToken;
    /// Address of the L2GraphTokenLockWallet implementation in L2, used to compute L2 wallet addresses
    address public immutable l2Implementation;
    /// Address of the L1GraphTokenGateway contract
    ITokenGateway public immutable l1Gateway;
    /// Address of the Staking contract, used to pull ETH for L2 ticket gas
    address payable public immutable staking;
    /// L2 lock manager for each L1 lock manager.
    /// L1 GraphTokenLockManager => L2GraphTokenLockManager
    mapping(address => address) public l2LockManager;
    /// L2 wallet owner for each L1 wallet owner.
    /// L1 wallet owner => L2 wallet owner
    mapping(address => address) public l2WalletOwner;
    /// L2 wallet address for each migrated L1 wallet address.
    /// L1 wallet => L2 wallet
    mapping(address => address) public migratedWalletAddress;
    /// ETH balance from each token lock, used to pay for L2 gas:
    /// L1 wallet address => ETH balance
    mapping(address => uint256) public tokenLockETHBalances;
    /// L2 beneficiary corresponding to each L1 wallet address.
    /// L1 wallet => L2 beneficiary
    mapping(address => address) public migratedL2Beneficiary;
    /// Indicates whether a migrated wallet address for a wallet
    /// has been set manually, in which case it can't call depositToL2Locked.
    /// L1 wallet => bool
    mapping(address => bool) public migratedWalletAddressSetManually;

    /// @dev Emitted when the L2 lock manager for an L1 lock manager is set
    event L2LockManagerSet(address indexed l1LockManager, address indexed l2LockManager);
    /// @dev Emitted when the L2 wallet owner for an L1 wallet owner is set
    event L2WalletOwnerSet(address indexed l1WalletOwner, address indexed l2WalletOwner);
    /// @dev Emitted when GRT is sent to L2 from a token lock
    event LockedFundsSentToL2(
        address indexed l1Wallet,
        address indexed l2Wallet,
        address indexed l1LockManager,
        address l2LockManager,
        uint256 amount
    );
    /// @dev Emitted when an L2 wallet address is set for a migrated L1 wallet
    event MigratedWalletAddressSet(address indexed l1Wallet, address indexed l2Wallet);
    /// @dev Emitted when ETH is deposited to a token lock's account
    event ETHDeposited(address indexed tokenLock, uint256 amount);
    /// @dev Emitted when ETH is withdrawn from a token lock's account
    event ETHWithdrawn(address indexed tokenLock, address indexed destination, uint256 amount);
    /// @dev Emitted when ETH is pulled from a token lock's account by the Staking contract
    event ETHPulled(address indexed tokenLock, uint256 amount);

    /**
     * @notice Construct a new L1GraphTokenLockMigrator contract
     * @dev The deployer of the contract will become its owner.
     * @param _graphToken Address of the L1 GRT token contract
     * @param _l2Implementation Address of the L2GraphTokenLockWallet implementation in L2
     * @param _l1Gateway Address of the L1GraphTokenGateway contract
     * @param _staking Address of the Staking contract
     */
    constructor(
        IERC20 _graphToken,
        address _l2Implementation,
        ITokenGateway _l1Gateway,
        address payable _staking
    ) OZOwnable() {
        graphToken = _graphToken;
        l2Implementation = _l2Implementation;
        l1Gateway = _l1Gateway;
        staking = _staking;
    }

    /**
     * @notice Set the L2 lock manager that corresponds to an L1 lock manager
     * @param _l1LockManager Address of the L1 lock manager
     * @param _l2LockManager Address of the L2 lock manager (in L2)
     */
    function setL2LockManager(address _l1LockManager, address _l2LockManager) external onlyOwner {
        l2LockManager[_l1LockManager] = _l2LockManager;
        emit L2LockManagerSet(_l1LockManager, _l2LockManager);
    }

    /**
     * @notice Set the L2 wallet owner that corresponds to an L1 wallet owner
     * @param _l1WalletOwner Address of the L1 wallet owner
     * @param _l2WalletOwner Address of the L2 wallet owner (in L2)
     */
    function setL2WalletOwner(address _l1WalletOwner, address _l2WalletOwner) external onlyOwner {
        l2WalletOwner[_l1WalletOwner] = _l2WalletOwner;
        emit L2WalletOwnerSet(_l1WalletOwner, _l2WalletOwner);
    }

    /**
     * @notice Deposit ETH on a token lock's account, to be used for L2 retryable ticket gas.
     * This function can be called by anyone, but the ETH will be credited to the token lock.
     * DO NOT try to call this through the token lock, as locks do not forward ETH value (and the
     * function call should not be allowlisted).
     * @param _tokenLock Address of the L1 GraphTokenLockWallet that will own the ETH
     */
    function depositETH(address _tokenLock) external payable {
        tokenLockETHBalances[_tokenLock] = tokenLockETHBalances[_tokenLock].add(msg.value);
        emit ETHDeposited(_tokenLock, msg.value);
    }

    /**
     * @notice Withdraw ETH from a token lock's account.
     * This function must be called from the token lock contract, but the destination
     * _must_ be a different address, as any ETH sent to the token lock would otherwise be
     * lost.
     * @param _destination Address to send the ETH
     * @param _amount Amount of ETH to send
     */
    function withdrawETH(address _destination, uint256 _amount) external {
        // We can't send eth to a token lock or it will be stuck
        require(msg.sender != _destination, "INVALID_DESTINATION");
        require(tokenLockETHBalances[msg.sender] >= _amount, "INSUFFICIENT_BALANCE");
        tokenLockETHBalances[msg.sender] -= _amount;
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = payable(_destination).call{ value: _amount }("");
        require(success, "TRANSFER_FAILED");
        emit ETHWithdrawn(msg.sender, _destination, _amount);
    }

    /**
     * @notice Pull ETH from a token lock's account, to be used for L2 retryable ticket gas.
     * This can only be called by the Staking contract.
     * @param _tokenLock GraphTokenLockWallet that owns the ETH that will be debited
     * @param _amount Amount of ETH to pull
     */
    function pullETH(address _tokenLock, uint256 _amount) external {
        require(msg.sender == staking, "ONLY_STAKING");
        require(tokenLockETHBalances[_tokenLock] >= _amount, "INSUFFICIENT_BALANCE");
        tokenLockETHBalances[_tokenLock] -= _amount;
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = staking.call{ value: _amount }("");
        require(success, "TRANSFER_FAILED");
        emit ETHPulled(_tokenLock, _amount);
    }

    /**
     * @notice Deposit GRT to L2, from a token lock in L1 to a token lock in L2.
     * If the token lock in L2 does not exist, it will be created when the message is received
     * by the L2GraphTokenLockManager.
     * Before calling this (which must be done through the token lock wallet), make sure
     * there is enough ETH in the token lock's account to cover the L2 retryable ticket gas.
     * You can add ETH to the token lock's account by calling depositETH().
     * Note that after calling this, you will NOT be able to use setL2WalletAddressManually() to
     * set an L2 wallet address, as the L2 wallet address will be set automatically when the
     * message is received by the L2GraphTokenLockManager.
     * @dev The gas parameters for L2 can be estimated using the Arbitrum SDK.
     * @param _amount Amount of GRT to deposit
     * @param _l2Beneficiary Address of the beneficiary for the token lock in L2. Must be the same for subsequent calls of this function, and not an L1 contract.
     * @param _maxGas Maximum gas to use for the L2 retryable ticket
     * @param _gasPriceBid Gas price to use for the L2 retryable ticket
     * @param _maxSubmissionCost Max submission cost for the L2 retryable ticket
     */
    function depositToL2Locked(
        uint256 _amount,
        address _l2Beneficiary,
        uint256 _maxGas,
        uint256 _gasPriceBid,
        uint256 _maxSubmissionCost
    ) external {
        // Check that msg.sender is a GraphTokenLockWallet
        // That uses GRT and has a corresponding manager set in L2.
        GraphTokenLockWallet wallet = GraphTokenLockWallet(msg.sender);
        require(wallet.token() == graphToken, "INVALID_TOKEN");
        address l1Manager = address(wallet.manager());
        address l2Manager = l2LockManager[l1Manager];
        require(l2Manager != address(0), "INVALID_MANAGER");
        require(wallet.isInitialized(), "!INITIALIZED");
        require(wallet.revocable() != IGraphTokenLock.Revocability.Enabled, "REVOCABLE");
        require(_amount <= graphToken.balanceOf(msg.sender), "INSUFFICIENT_BALANCE");
        require(_amount != 0, "ZERO_AMOUNT");

        if (migratedL2Beneficiary[msg.sender] == address(0)) {
            require(_l2Beneficiary != address(0), "INVALID_BENEFICIARY_ZERO");
            require(!Address.isContract(_l2Beneficiary), "INVALID_BENEFICIARY_CONTRACT");
            migratedL2Beneficiary[msg.sender] = _l2Beneficiary;
        } else {
            require(migratedL2Beneficiary[msg.sender] == _l2Beneficiary, "INVALID_BENEFICIARY");
        }

        uint256 expectedEth = _maxSubmissionCost.add(_maxGas.mul(_gasPriceBid));
        require(tokenLockETHBalances[msg.sender] >= expectedEth, "INSUFFICIENT_ETH_BALANCE");
        tokenLockETHBalances[msg.sender] -= expectedEth;

        bytes memory encodedData;
        {
            address l2Owner = l2WalletOwner[wallet.owner()];
            require(l2Owner != address(0), "L2_OWNER_NOT_SET");
            // Extract all the storage variables from the GraphTokenLockWallet
            L2GraphTokenLockManager.MigratedWalletData memory data = L2GraphTokenLockManager.MigratedWalletData({
                l1Address: msg.sender,
                owner: l2Owner,
                beneficiary: migratedL2Beneficiary[msg.sender],
                managedAmount: wallet.managedAmount(),
                startTime: wallet.startTime(),
                endTime: wallet.endTime()
            });
            encodedData = abi.encode(data);
        }

        if (migratedWalletAddress[msg.sender] == address(0)) {
            address newAddress = getDeploymentAddress(
                keccak256(encodedData),
                l2Implementation,
                l2Manager
            );
            migratedWalletAddress[msg.sender] = newAddress;
            emit MigratedWalletAddressSet(msg.sender, newAddress);
        } else {
            require(!migratedWalletAddressSetManually[msg.sender], "CANT_DEPOSIT_TO_MANUAL_ADDRESS");
        }

        graphToken.transferFrom(msg.sender, address(this), _amount);

        // Send the tokens with a message through the L1GraphTokenGateway to the L2GraphTokenLockManager
        graphToken.approve(address(l1Gateway), _amount);
        {
            bytes memory transferData = abi.encode(_maxSubmissionCost, encodedData);
            l1Gateway.outboundTransfer{ value: expectedEth }(
                address(graphToken),
                l2Manager,
                _amount,
                _maxGas,
                _gasPriceBid,
                transferData
            );
        }
        emit LockedFundsSentToL2(msg.sender, migratedWalletAddress[msg.sender], l1Manager, l2Manager, _amount);
    }

    /**
     * @notice Manually set the L2 wallet address for a token lock in L1.
     * This will only work for token locks that have not been migrated to L2 yet, and
     * that are fully vested (endTime < current timestamp).
     * This address can then be used to send stake or delegation to L2 on the Staking contract.
     * After calling this, the vesting lock will NOT be allowed to use depositToL2Locked
     * to send GRT to L2, the beneficiary must withdraw the tokens and bridge them manually.
     * @param _l2Wallet Address of the L2 wallet
     */
    function setL2WalletAddressManually(address _l2Wallet) external {
        // Check that msg.sender is a GraphTokenLockWallet
        // That uses GRT and has a corresponding manager set in L2.
        GraphTokenLockWallet wallet = GraphTokenLockWallet(msg.sender);
        require(wallet.token() == graphToken, "INVALID_TOKEN");
        address l1Manager = address(wallet.manager());
        address l2Manager = l2LockManager[l1Manager];
        require(l2Manager != address(0), "INVALID_MANAGER");
        require(wallet.isInitialized(), "!INITIALIZED");

        // Check that the wallet is fully vested
        require(wallet.endTime() < block.timestamp, "NOT_FULLY_VESTED");

        // Check that the wallet has not been migrated to L2 yet
        require(migratedWalletAddress[msg.sender] == address(0), "ALREADY_MIGRATED");

        // Check that the L2 address is not zero
        require(_l2Wallet != address(0), "ZERO_ADDRESS");
        // Set the L2 wallet address
        migratedWalletAddress[msg.sender] = _l2Wallet;
        migratedWalletAddressSetManually[msg.sender] = true;
        emit MigratedWalletAddressSet(msg.sender, _l2Wallet);
    }
}
