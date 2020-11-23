# Graph Protocol Token Lock

This repository contains a number of contracts that will support the locking of tokens of participants under different schedules.
An important premise is that participants with locked tokens can perform a number of restricted actions in the protocol with their tokens.

## Contracts

### GraphTokenLock

The contract lock manages a number of tokens deposited into the contract to ensure that they can only be released under certain time conditions.

This contract implements a release scheduled based on periods where tokens are released in steps after each period ends. It can be configured with one period in which case it works like a plain TimeLock.
It also supports revocation by the contract owner to be used for vesting schedules.

The contract supports receiving extra funds over the managed tokens that can be withdrawn by the beneficiary at any time.

A releaseStartTime parameter is included to override the default release schedule and perform the first release on the configured time. After that initial release it will continue with the default schedule.
### GraphTokenLockWallet

This contract is built on top of the base **GraphTokenLock** functionality. It allows the use of locked funds only when authorized function calls are issued to the contract. 
It works by "forwarding" authorized function calls to predefined target contracts in the Graph Network.

The idea is that supporters with locked tokens can participate in the protocol but disallow any release before the vesting/lock schedule.
The function calls allowed are queried to the **GraphTokenLockManager**, this way the same configuration can be shared for all the created lock wallet contracts.

Locked tokens must only leave this contract under the locking rules and by the beneficiary calling release(). Tokens used in the protocol need to get back to this contract when unstaked or undelegated.

Some users can profit by participating in the protocol through their locked tokens, if they withdraw them from the protocol back to the lock contract, they should be able to withdraw those surplus funds out of the contract.

The following functions signatures will be authorized for use:

```
### Target

- Staking contract address


### Function Signatures

- setOperator(address,bool)

- stake(uint256)
- unstake(uint256)
- withdraw()

- setDelegationParameters(uint32,uint32,uint32)
- delegate(address,uint256)
- undelegate(address,uint256)
- withdrawDelegated(address,address)
```

### GraphTokenLockManager

Contract that works as a factory of **GraphTokenLockWallet** contracts. It manages the function calls authorized to be called on any GraphTokenWallet and also holds addresses of our protocol contracts configured as targets.

The Manager supports creating TokenLock contracts based on a mastercopy bytecode using a Minimal Proxy to save gas. It also do so with CREATE2 to have reproducible addresses, this way any future to be deployed contract address can be passed to beneficiaries before actual deployment.

For convenience, the Manager will also fund the created contract with the amount of each contract's managed tokens.