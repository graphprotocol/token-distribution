# Graph Protocol Token Lock

This repository contains a number of contracts that will support the locking of tokens for participants under time conditions.
An important premise is that participants with locked tokens can perform a number of restricted actions in the protocol with their tokens.

## Contracts

### GraphTokenLock

The contract lock manage a number of tokens deposited into the contract to ensure that they can only be released under certain time conditions.

This contract implements a release scheduled based on periods and tokens are released in steps after each period ends. It can be configured with one period in which case it is like a plain TimeLock.
It also supports revocation to be used for vesting schedules.

The contract supports receiving extra funds than the managed tokens ones that can be withdrawn by the beneficiary at any time.

A releaseStartTime parameter is included to override the default release schedule and perform the first release on the configured time. After that it will continue with the default schedule.
### GraphTokenLockWallet

This contract is built on top of the base **GraphTokenLock** functionality. It allows the use of locked funds only when certain function calls are issued to the contract. 
It works by "forwarding" authorized function calls to predefined target contracts, being those our protocol contracts.

The idea is that supporters with locked tokens can participate in the protocol but disallow any release before the vesting/lock schedule.
The function calls allowed are queried to the **GraphTokenLockManager**, this way the same configuration can be shared for all the created lock wallet contracts.

Locked tokens must only leave this contract under the locking rules, and when used in the protocol they need to get back to this contract.

Some users can profit by participating in the protocol through their locked tokens, if they withdraw them from the protocol back to the lock contract, they should be able to withdraw those surplus funds out of the contract.

### GraphTokenLockManager

Contract that works as a factory of **GraphTokenLockWallet** contracts. It manages the function calls authorized to be called on any GraphTokenWallet and also holds addresses of our protocol contracts.
