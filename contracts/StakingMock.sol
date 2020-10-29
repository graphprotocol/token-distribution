pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./Stakes.sol";

contract StakingMock {
    using SafeMath for uint256;
    using Stakes for Stakes.Indexer;

    // -- State --

    uint256 public minimumIndexerStake = 100e18;
    IERC20 public token;

    // Indexer stakes : indexer => Stake
    mapping(address => Stakes.Indexer) public stakes;

    /**
     * @dev Emitted when `indexer` stake `tokens` amount.
     */
    event StakeDeposited(address indexed indexer, uint256 tokens);

    // Contract constructor.
    constructor(IERC20 _token) {
        require(address(_token) != address(0), "!token");
        token = _token;
    }

    /**
     * @dev Deposit tokens on the indexer stake.
     * @param _tokens Amount of tokens to stake
     */
    function stake(uint256 _tokens) external {
        stakeTo(msg.sender, _tokens);
    }

    /**
     * @dev Deposit tokens on the indexer stake.
     * @param _indexer Address of the indexer
     * @param _tokens Amount of tokens to stake
     */
    function stakeTo(address _indexer, uint256 _tokens) public {
        require(_tokens > 0, "!tokens");

        // Ensure minimum stake
        require(stakes[_indexer].tokensSecureStake().add(_tokens) >= minimumIndexerStake, "!minimumIndexerStake");

        // Transfer tokens to stake from caller to this contract
        require(token.transferFrom(msg.sender,  address(this), _tokens), "!transfer");

        // Stake the transferred tokens
        _stake(_indexer, _tokens);
    }

    function _stake(address _indexer, uint256 _tokens) internal {
        // Deposit tokens into the indexer stake
        Stakes.Indexer storage indexerStake = stakes[_indexer];
        indexerStake.deposit(_tokens);

        emit StakeDeposited(_indexer, _tokens);
    }
}
