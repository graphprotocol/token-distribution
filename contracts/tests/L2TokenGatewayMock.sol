// SPDX-License-Identifier: MIT

pragma solidity ^0.7.3;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import { ITokenGateway } from "../arbitrum//ITokenGateway.sol";

/**
 * @title L2 Token Gateway mock contract
 * @dev Used for testing purposes, DO NOT USE IN PRODUCTION
 */
contract L2TokenGatewayMock is Ownable {

    address public immutable l1Token;
    address public immutable l2Token;
    uint256 public nextId;

    event FakeTxToL1(
        address from,
        bytes outboundCalldata
    );
    // Emitted when an outbound transfer is initiated, i.e. tokens are withdrawn to L1 from L2
    event WithdrawalInitiated(
        address l1Token,
        address indexed from,
        address indexed to,
        uint256 indexed sequenceNumber,
        uint256 amount
    );

    /**
     * @dev L2 Token Gateway Contract Constructor.
     */
    constructor(address _l1Token, address _l2Token) {
        l1Token = _l1Token;
        l2Token = _l2Token;
    }

    /**
     * @notice Creates and sends a fake transfer of GRT to L1.
     * This mock will actually just emit an event with parameters equivalent to what the real L2GraphTokenGateway
     * would send to L1.
     * @param _l1Token L1 Address of the GRT contract (needed for compatibility with Arbitrum Gateway Router)
     * @param _to Recipient address on L2
     * @param _amount Amount of tokens to tranfer
     * @param _data Encoded maxSubmissionCost and sender address along with additional calldata
     * @return Sequence number of the retryable ticket created by Inbox (always )
     */
    function outboundTransfer(
        address _l1Token,
        address _to,
        uint256 _amount,
        uint256,
        uint256,
        bytes calldata _data
    ) external payable returns (bytes memory) {
        require(_l1Token == l1Token, "INVALID_L1_TOKEN");
        require(_amount > 0, "INVALID_ZERO_AMOUNT");
        require(_to != address(0), "INVALID_DESTINATION");

        // nested scopes to avoid stack too deep errors
        address from;
        uint256 id = nextId;
        nextId += 1;
        {
            bytes memory outboundCalldata;
            {
                bytes memory extraData;
                (from, extraData) = _parseOutboundData(_data);

                require(msg.value == 0, "!value");
                require(extraData.length == 0, "!extraData");
                outboundCalldata = getOutboundCalldata(_l1Token, from, _to, _amount, extraData);
            }
            {
                // burn tokens from the sender, they will be released from escrow in L1
                ERC20Burnable(l2Token).burnFrom(from, _amount);

                emit FakeTxToL1(from, outboundCalldata);
            }
        }
        emit WithdrawalInitiated(_l1Token, from, _to, id, _amount);

        return abi.encode(id);
    }

    /**
     * @notice (Mock) Receives withdrawn tokens from L1
     * Actually does nothing, just keeping it here as its useful to define the expected
     * calldata for the outgoing transfer in tests.
     * @param _l1Token L1 Address of the GRT contract (needed for compatibility with Arbitrum Gateway Router)
     * @param _from Address of the sender
     * @param _to Recepient address on L1
     * @param _amount Amount of tokens transferred
     * @param _data Additional calldata
     */
    function finalizeInboundTransfer(
        address _l1Token,
        address _from,
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) external payable {}

    /**
     * @notice Decodes calldata required for migration of tokens
     * @dev extraData can be left empty
     * @param _data Encoded callhook data
     * @return Sender of the tx
     * @return Any other data sent to L1
     */
    function _parseOutboundData(bytes calldata _data) private view returns (address, bytes memory) {
        address from;
        bytes memory extraData;
        // The mock doesn't take messages from the Router
        from = msg.sender;
        extraData = _data;
        return (from, extraData);
    }

    /**
     * @notice Creates calldata required to create a tx to L1
     * @param _l1Token Address of the Graph token contract on L1
     * @param _from Address on L2 from which we're transferring tokens
     * @param _to Address on L1 to which we're transferring tokens
     * @param _amount Amount of GRT to transfer
     * @param _data Additional call data for the L1 transaction, which must be empty
     * @return Encoded calldata (including function selector) for the L1 transaction
     */
    function getOutboundCalldata(
        address _l1Token,
        address _from,
        address _to,
        uint256 _amount,
        bytes memory _data
    ) public pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                ITokenGateway.finalizeInboundTransfer.selector,
                _l1Token,
                _from,
                _to,
                _amount,
                abi.encode(0, _data)
            );
    }

    /**
     * @notice Calculate the L2 address of a bridged token
     * @dev In our case, this would only work for GRT.
     * @param l1ERC20 address of L1 GRT contract
     * @return L2 address of the bridged GRT token
     */
    function calculateL2TokenAddress(address l1ERC20) public view returns (address) {
        if (l1ERC20 != l1Token) {
            return address(0);
        }
        return l2Token;
    }
}