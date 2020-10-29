# Graph Protocol Token Lock

This repository contains a number of contracts that will support the locking of tokens for participants under time conditions.
An important premise is that participants with locked tokens can perform a number of restricted actions in the protocol with their tokens.

## Contracts

### GraphTokenLock

Contract that manages an unlocking schedule of tokens for participants in the Graph Network to be released under certain time conditions. The time conditions include a startTime, endTime and number of periods. This contract can be used with zero periods in which case it is like a plain TimeLock.

It supports revocation to be used for certain participants with vesting schedules. The contract also supports receiving extra funds over the managed tokens that can be withdrawn.

### GraphTokenLockWallet

This contract is built on top of the base **GraphTokenLock** functionality. It allows the use of locked funds only when certain function calls are issued to the contract. 
It works by "forwarding" authorized function calls to predefined target contracts, being those our protocol contracts.

The idea is that supporters with locked tokens can participate in the protocol but disallow any release before the vesting/lock schedule.
The function calls allowed are queried to the **GraphTokenLockManager**, this way the same configuration can be shared for all the created lock wallet contracts.

Locked tokens must only leave this contract under the locking rules, and when used in the protocol they need to get back to this contract.

Some users can profit by participating in the protocol through their locked tokens, if they withdraw them from the protocol back to the lock contract, they should be able to withdraw those surplus funds out of the contract.

### GraphTokenLockManager

Contract that works as a factory of **GraphTokenLockWallet** contracts. It manages the function calls authorized to be called on any GraphTokenWallet and also holds addresses of our protocol contracts.
