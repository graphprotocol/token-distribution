// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

/**
 * -- GraphTokenDistributor --
 * Contract that allows distribution of tokens to multiple beneficiaries.
 * The contract accept deposits in the configured token by anyone.
 * The owner can setup the desired distribution by setting the amount of tokens
 * assigned to each beneficiary account.
 * Beneficiaries claim for their allocated tokens.
 * Only the owner can withdraw tokens from this contract without limitations.
 * For the distribution to work this contract must be unlocked by the owner.
 */
contract GraphTokenDistributor is Ownable {
    using SafeMath for uint;
    using SafeERC20 for IERC20;

    // -- State --

    bool public locked;
    mapping (address => uint) public beneficiaries;

    IERC20 public token;

    // -- Events --

    event BeneficiaryUpdated(address indexed beneficiary, uint amount);
    event TokensDeposited(address indexed sender, uint amount);
    event TokensWithdrawn(address indexed sender, uint amount);
    event TokensClaimed(address indexed beneficiary, address to, uint amount);
    event LockUpdated(bool locked);

    /**
     * Constructor.
     * @param _token Token to use for deposits and withdrawals
     */
    constructor(IERC20 _token) {
        token = _token;
        locked = true;
    }

    /**
     * Deposit tokens into the contract.
     * Even if the ERC20 token can be transferred directly to the contract
     * this function provide a safe interface to do the transfer and avoid mistakes
     * @param _amount Amount to deposit
     */
    function deposit(uint _amount) external {
        token.safeTransferFrom(msg.sender, address(this), _amount);
        emit TokensDeposited(msg.sender, _amount);
    }

    // -- Admin functions --

    /**
     * Add tokens to account.
     * @param _account Address to assign tokens to
     * @param _amount Amount of tokens to assign to beneficiary
     */
    function addBeneficiaryTokens(address _account, uint _amount) onlyOwner external {
        _setBeneficiaryTokens(_account, beneficiaries[_account].add(_amount));
    }

    /**
     * Add tokens to multiple accounts.
     * @param _accounts Addresses to assign tokens to
     * @param _amounts Amounts of tokens to assign to beneficiary
     */
    function addBeneficiaryTokensMulti(address[] calldata _accounts, uint[] calldata _amounts) onlyOwner external {
        require(_accounts.length == _amounts.length, "Distributor: !length");
        for (uint i = 0; i < _accounts.length; i++) {
            _setBeneficiaryTokens(_accounts[i], beneficiaries[_accounts[i]].add(_amounts[i]));
        }
    }

    /**
     * Remove tokens from account.
     * @param _account Address to assign tokens to
     * @param _amount Amount of tokens to assign to beneficiary
     */
    function subBeneficiaryTokens(address _account, uint _amount) onlyOwner external {
        _setBeneficiaryTokens(_account, beneficiaries[_account].sub(_amount));
    }

    /**
     * Remove tokens from multiple accounts.
     * @param _accounts Addresses to assign tokens to
     * @param _amounts Amounts of tokens to assign to beneficiary
     */
    function subBeneficiaryTokensMulti(address[] calldata _accounts, uint[] calldata _amounts) onlyOwner external {
        require(_accounts.length == _amounts.length, "Distributor: !length");
        for (uint i = 0; i < _accounts.length; i++) {
            _setBeneficiaryTokens(_accounts[i], beneficiaries[_accounts[i]].sub(_amounts[i]));
        }
    }

    /**
     * Set amount of tokens for beneficiary.
     * @param _account Address to assign tokens to
     * @param _amount Amount of tokens to assign to beneficiary
     */
    function _setBeneficiaryTokens(address _account, uint _amount) private {
        require(_account != address(0), "Distributor: !account");

        beneficiaries[_account] = _amount;
        emit BeneficiaryUpdated(_account, _amount);
    }

    /**
     * Set locked withdrawals.
     * @param _locked True to lock withdrawals
     */
    function setLocked(bool _locked) onlyOwner external {
        locked = _locked;
        emit LockUpdated(_locked);
    }

    /**
     * Withdraw tokens from the contract. This function is included as 
     * a escape hatch in case of mistakes or to recover remaining funds.
     * @param _amount Amount of tokens to withdraw
     */
    function withdraw(uint _amount) onlyOwner external {
        token.safeTransfer(msg.sender, _amount);
        emit TokensWithdrawn(msg.sender, _amount);
    }

    // -- Beneficiary functions --

    /**
     * Claim tokens and send to caller.
     */
    function claim() external {
        claimTo(msg.sender);
    }

    /**
     * Claim tokens and send to address.
     * @param _to Address where to send tokens
     */
    function claimTo(address _to) public {
        require(locked == false, "Distributor: Claim is locked");
        uint claimableTokens = beneficiaries[msg.sender];
        require(claimableTokens > 0, "Distributor: Unavailable funds");

        _setBeneficiaryTokens(msg.sender, 0);

        token.safeTransfer(_to, claimableTokens);
        emit TokensClaimed(msg.sender, _to, claimableTokens);
    }
}
