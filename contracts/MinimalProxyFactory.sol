// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

contract MinimalProxyFactory is Ownable {
    // -- Events --

    event ProxyCreated(address proxy);

    /**
     * @notice Gets the deterministic CREATE2 address for MinimalProxy with a particular implementation
     * @param _salt Bytes32 salt to use for CREATE2
     * @param _implementation Address of the proxy target implementation
     * @return Address of the counterfactual MinimalProxy
     */
    function getDeploymentAddress(bytes32 _salt, address _implementation) public view returns (address) {
        return Create2.computeAddress(_salt, keccak256(_getContractCreationCode(_implementation)), address(this));
    }

    /**
     * Deploy a MinimalProxy with CREATE
     * @param _implementation Address of the proxy target implementation
     * @param _data Bytes with the initializer call
     * @return proxy Address of the deployed MinimalProxy
     */
    function _deployProxy(address _implementation, bytes memory _data) internal returns (address proxy) {
        // Adapted from https://github.com/OpenZeppelin/openzeppelin-sdk/blob/v2.5.0/packages/lib/contracts/upgradeability/ProxyFactory.sol
        bytes20 targetBytes = bytes20(_implementation);
        assembly {
            let clone := mload(0x40)
            mstore(clone, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(clone, 0x14), targetBytes)
            mstore(add(clone, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            proxy := create(0, clone, 0x37)
        }

        emit ProxyCreated(address(proxy));

        if (_data.length > 0) {
            (bool success, ) = proxy.call(_data);
            require(success, "MinimalProxyFactory#create: CALL_FAILED");
        }
    }

    /**
     * @notice Deploys a MinimalProxy with CREATE2
     * @param _salt Bytes32 salt to use for CREATE2
     * @param _implementation Address of the proxy target implementation
     * @param _data Bytes with the initializer call
     * @return Address of the deployed MinimalProxy
     */
    function _deployProxy2(
        bytes32 _salt,
        address _implementation,
        bytes memory _data
    ) public returns (address) {
        address proxyAddress = Create2.deploy(0, _salt, _getContractCreationCode(_implementation));

        emit ProxyCreated(proxyAddress);

        if (_data.length > 0) {
            (bool success, ) = proxyAddress.call(_data);
            require(success, "MinimalProxyFactory#create2: CALL_FAILED");
        }

        return proxyAddress;
    }

    /**
     * @notice Gets the MinimalProxy bytecode
     * @param _implementation Address of the proxy target implementation
     * @return MinimalProxy bytecode
     */
    function _getContractCreationCode(address _implementation) internal pure returns (bytes memory) {
        bytes10 creation = 0x3d602d80600a3d3981f3;
        bytes10 prefix = 0x363d3d373d3d3d363d73;
        bytes20 targetBytes = bytes20(_implementation);
        bytes15 suffix = 0x5af43d82803e903d91602b57fd5bf3;
        return abi.encodePacked(creation, prefix, targetBytes, suffix);
    }
}
