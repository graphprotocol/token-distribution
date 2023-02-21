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
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

contract L1GraphTokenLockMigrator is MinimalProxyFactory {
    using SafeMath for uint256;

    IERC20 public immutable graphToken;
    address public immutable l2Implementation;
    ITokenGateway public immutable l1Gateway;
    address payable public immutable staking;
    /// L1 GraphTokenLockManager => L2GraphTokenLockManager
    mapping(address => address) public l2LockManager;
    mapping(address => address) public migratedWalletAddress;
    /// ETH balance from each token lock, used to pay for L2 gas
    mapping(address => uint256) public tokenLockETHBalances;

    event L2LockManagerSet(address indexed l1LockManager, address indexed l2LockManager);
    event LockedFundsSentToL2(
        address indexed l1Wallet,
        address indexed l2Wallet,
        address indexed l1LockManager,
        address l2LockManager,
        uint256 amount
    );
    event ETHDeposited(address indexed tokenLock, uint256 amount);
    event ETHWithdrawn(address indexed tokenLock, address indexed destination, uint256 amount);
    event ETHPulled(address indexed tokenLock, uint256 amount);

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

    function setL2LockManager(address _l1LockManager, address _l2LockManager) external onlyOwner {
        l2LockManager[_l1LockManager] = _l2LockManager;
        emit L2LockManagerSet(_l1LockManager, _l2LockManager);
    }

    function depositETH(address _tokenLock) external payable {
        tokenLockETHBalances[_tokenLock] = tokenLockETHBalances[_tokenLock].add(msg.value);
        emit ETHDeposited(_tokenLock, msg.value);
    }

    function withdrawETH(address _destination, uint256 _amount) external {
        // We can't send eth to a token lock or it will be stuck
        require(msg.sender != _destination, "INVALID_DESTINATION");
        require(tokenLockETHBalances[msg.sender] >= _amount, "INSUFFICIENT_BALANCE");
        tokenLockETHBalances[msg.sender] -= _amount;
        (bool success, ) = payable(_destination).call{ value: _amount }("");
        require(success, "TRANSFER_FAILED");
        emit ETHWithdrawn(msg.sender, _destination, _amount);
    }

    function pullETH(address _tokenLock, uint256 _amount) external {
        require(msg.sender == staking, "ONLY_STAKING");
        require(tokenLockETHBalances[_tokenLock] >= _amount, "INSUFFICIENT_BALANCE");
        tokenLockETHBalances[_tokenLock] -= _amount;
        (bool success, ) = staking.call{ value: _amount }("");
        require(success, "TRANSFER_FAILED");
        emit ETHPulled(_tokenLock, _amount);
    }

    function depositToL2Locked(
        uint256 _amount,
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
        require(wallet.isAccepted(), "!ACCEPTED");
        require(wallet.isInitialized(), "!INITIALIZED");
        require(wallet.revocable() != IGraphTokenLock.Revocability.Enabled, "REVOCABLE");
        require(_amount <= graphToken.balanceOf(msg.sender), "INSUFFICIENT_BALANCE");
        require(_amount != 0, "ZERO_AMOUNT");

        uint256 expectedEth = _maxSubmissionCost.add(_maxGas.mul(_gasPriceBid));
        require(tokenLockETHBalances[msg.sender] >= expectedEth, "INSUFFICIENT_ETH_BALANCE");
        tokenLockETHBalances[msg.sender] -= expectedEth;
        // Extract all the storage variables from the GraphTokenLockWallet
        L2GraphTokenLockManager.MigratedWalletData memory data = L2GraphTokenLockManager.MigratedWalletData({
            l1Address: msg.sender,
            owner: wallet.owner(),
            beneficiary: wallet.beneficiary(),
            managedAmount: wallet.managedAmount(),
            startTime: wallet.startTime(),
            endTime: wallet.endTime()
        });
        // Build the encoded message for L2
        bytes memory encodedData = abi.encode(data);

        if (migratedWalletAddress[msg.sender] == address(0)) {
            migratedWalletAddress[msg.sender] = getDeploymentAddress(
                keccak256(encodedData),
                l2Implementation,
                l2Manager
            );
        }

        graphToken.transferFrom(msg.sender, address(this), _amount);

        // Send the tokens with a message through the L1GraphTokenGateway to the L2GraphTokenLockManager
        graphToken.approve(address(l1Gateway), _amount);
        bytes memory transferData = abi.encode(_maxSubmissionCost, encodedData);
        l1Gateway.outboundTransfer{ value: expectedEth }(
            address(graphToken),
            l2Manager,
            _amount,
            _maxGas,
            _gasPriceBid,
            transferData
        );
        emit LockedFundsSentToL2(msg.sender, migratedWalletAddress[msg.sender], l1Manager, l2Manager, _amount);
    }
}
