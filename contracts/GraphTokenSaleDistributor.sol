// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "./GraphTokenBaseDistributor.sol";

// TODO: update comment

/**
 * @title GraphTokenSaleDistributor
 * @dev Contract that allows distribution of tokens to multiple beneficiaries.
 * The contract accept deposits in the configured token by anyone.
 * The owner can setup the desired distribution by setting the amount of tokens
 * assigned to each beneficiary account.
 * Beneficiaries claim for their allocated tokens.
 * Only the owner can withdraw tokens from this contract without limitations.
 * For the distribution to work this contract must be unlocked by the owner.
 */
contract GraphTokenSaleDistributor is GraphTokenBaseDistributor {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // -- State --

    mapping (address => bool) public claims;

    IERC20 graphPreToken;

    // -- Beneficiary functions --

    /**
     * Constructor.
     * @param _graphPreToken Address of the Graph Sale contract
     */
    constructor(IERC20 _graphPreToken) {
        require(address(_graphPreToken) != address(0), "Distributor: GraphPreToken must be set");
        graphPreToken = _graphPreToken;
    }

    /**
     * @dev Return the amount of claimable tokens by the beneficiary.
     * @param _beneficiary Address of the beneficiary account to check for balances
     */
    function claimableAmount(address _beneficiary) public view override returns (uint256) {
        if(claims[_beneficiary] == true) {
            return 0;
        }
        return graphPreToken.balanceOf(_beneficiary);
    }

    /**
     * Claim tokens and send to address.
     * @param _to Address where to send tokens
     */
    function claimTo(address _to) public override {
        require(address(token) != address(0), "Distributor: token not set");
        require(locked == false, "Distributor: Claim is locked");

        uint256 claimableTokens = claimableAmount(msg.sender);
        require(claimableTokens > 0, "Distributor: Unavailable funds");

        claims[msg.sender] = true;

        token.safeTransfer(_to, claimableTokens);
        emit TokensClaimed(msg.sender, _to, claimableTokens);
    }
}
