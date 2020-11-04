// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/**
 * @title GraphTokenBaseDistributor
 */
abstract contract GraphTokenBaseDistributor is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // -- State --

    bool public locked;

    IERC20 public token;

    // -- Events --

    event TokensDeposited(address indexed sender, uint256 amount);
    event TokensWithdrawn(address indexed sender, uint256 amount);
    event TokensClaimed(address indexed beneficiary, address to, uint256 amount);
    event LockUpdated(bool locked);
    event TokenUpdated(address token);

    /**
     * Constructor.
     */
    constructor() {
        locked = true;
    }

    /**
     * Set the token used for the distribution.
     * This function is included with the purpose of allowing a delayed token configuration
     * detached from the actual contract deployment.
     * This allow operational tasks to be performed, like setting beneficiaries even before
     * the token is actually deployed.
     * @param _token ERC20 token address
     */
    function setToken(IERC20 _token) onlyOwner public {
        require(address(_token) != address(0), "Distributor: !token");
        token = _token;
        emit TokenUpdated(address(token));
    }

    /**
     * Set locked withdrawals.
     * @param _locked True to lock withdrawals
     */
    function setLocked(bool _locked) onlyOwner external {
        locked = _locked;
        emit LockUpdated(_locked);
    }

    // -- Token Transfer Admin --

    /**
     * Deposit tokens into the contract.
     * Even if the ERC20 token can be transferred directly to the contract
     * this function provide a safe interface to do the transfer and avoid mistakes
     * @param _amount Amount to deposit
     */
    function deposit(uint256 _amount) external {
        require(address(token) != address(0), "Distributor: token not set");
        token.safeTransferFrom(msg.sender, address(this), _amount);
        emit TokensDeposited(msg.sender, _amount);
    }

    /**
     * Withdraw tokens from the contract. This function is included as 
     * a escape hatch in case of mistakes or to recover remaining funds.
     * @param _amount Amount of tokens to withdraw
     */
    function withdraw(uint256 _amount) onlyOwner external {
        require(address(token) != address(0), "Distributor: token not set");
        token.safeTransfer(msg.sender, _amount);
        emit TokensWithdrawn(msg.sender, _amount);
    }

    // -- Beneficiary functions --

    /**
     * @dev Return the amount of claimable tokens by the beneficiary.
     */
    function claimableAmount(address _beneficiary) public view virtual returns (uint256);

    /**
     * @dev Claim available tokens.
     */
    function claim() external {
        claimTo(msg.sender);
    }

    /**
     * @dev Claim available tokens.
     * @param _to Address where to send tokens
     */
    function claimTo(address _to) public virtual;
}
