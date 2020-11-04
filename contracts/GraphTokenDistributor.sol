// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./GraphTokenBaseDistributor.sol";

/**
 * @title GraphTokenDistributor
 * @dev Contract that allows distribution of tokens to multiple beneficiaries.
 * The contract accept deposits in the configured token by anyone.
 * The owner can setup the desired distribution by setting the amount of tokens
 * assigned to each beneficiary account.
 * Beneficiaries claim for their allocated tokens.
 * Only the owner can withdraw tokens from this contract without limitations.
 * For the distribution to work this contract must be unlocked by the owner.
 */
contract GraphTokenDistributor is GraphTokenBaseDistributor {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // -- State --

    mapping(address => uint256) public beneficiaries;

    // -- Events --

    event BeneficiaryUpdated(address indexed beneficiary, uint256 amount);

    // -- Beneficiaries Admin --

    /**
     * Add tokens to account.
     * @param _account Address to assign tokens to
     * @param _amount Amount of tokens to assign to beneficiary
     */
    function addBeneficiaryTokens(address _account, uint256 _amount) external onlyOwner {
        _setBeneficiaryTokens(_account, beneficiaries[_account].add(_amount));
    }

    /**
     * Add tokens to multiple accounts.
     * @param _accounts Addresses to assign tokens to
     * @param _amounts Amounts of tokens to assign to beneficiary
     */
    function addBeneficiaryTokensMany(address[] calldata _accounts, uint256[] calldata _amounts) external onlyOwner {
        require(_accounts.length == _amounts.length, "Distributor: !length");
        for (uint256 i = 0; i < _accounts.length; i++) {
            _setBeneficiaryTokens(_accounts[i], beneficiaries[_accounts[i]].add(_amounts[i]));
        }
    }

    /**
     * Remove tokens from account.
     * @param _account Address to assign tokens to
     * @param _amount Amount of tokens to assign to beneficiary
     */
    function subBeneficiaryTokens(address _account, uint256 _amount) external onlyOwner {
        _setBeneficiaryTokens(_account, beneficiaries[_account].sub(_amount));
    }

    /**
     * Remove tokens from multiple accounts.
     * @param _accounts Addresses to assign tokens to
     * @param _amounts Amounts of tokens to assign to beneficiary
     */
    function subBeneficiaryTokensMulti(address[] calldata _accounts, uint256[] calldata _amounts) external onlyOwner {
        require(_accounts.length == _amounts.length, "Distributor: !length");
        for (uint256 i = 0; i < _accounts.length; i++) {
            _setBeneficiaryTokens(_accounts[i], beneficiaries[_accounts[i]].sub(_amounts[i]));
        }
    }

    /**
     * Set amount of tokens for beneficiary.
     * @param _account Address to assign tokens to
     * @param _amount Amount of tokens to assign to beneficiary
     */
    function _setBeneficiaryTokens(address _account, uint256 _amount) private {
        require(_account != address(0), "Distributor: !account");

        beneficiaries[_account] = _amount;
        emit BeneficiaryUpdated(_account, _amount);
    }

    // -- Beneficiary functions --

    /**
     * @dev Return the amount of claimable tokens by the beneficiary.
     * @param _beneficiary Address of the beneficiary account to check for balances
     */
    function claimableAmount(address _beneficiary) public override view returns (uint256) {
        return beneficiaries[_beneficiary];
    }

    /**
     * Claim available tokens in full and send to address.
     * @param _to Address where to send tokens
     */
    function claimTo(address _to) public override {
        require(address(token) != address(0), "Distributor: token not set");
        require(locked == false, "Distributor: Claim is locked");

        uint256 claimableTokens = claimableAmount(msg.sender);
        require(claimableTokens > 0, "Distributor: Unavailable funds");

        _setBeneficiaryTokens(msg.sender, 0);

        token.safeTransfer(_to, claimableTokens);
        emit TokensClaimed(msg.sender, _to, claimableTokens);
    }
}
