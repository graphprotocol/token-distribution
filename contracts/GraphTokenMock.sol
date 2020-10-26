// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Graph Token Mock
 */
contract GraphTokenMock is Ownable, ERC20 {
    /**
     * @dev Contract Constructor.
     * @param _initialSupply Initial supply
     */
    constructor(uint256 _initialSupply, address _mintTo) ERC20("Graph Token Mock", "GRT-Mock") {
        // Deploy to mint address
        _mint(_mintTo, _initialSupply);
    }
}
