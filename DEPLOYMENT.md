

## Deploy a TokenManager

Deploy a Token Manager contract:
During this process the mastecopy of the TokenLockWallet will be deployed and used in the Manager.

```
npx hardhat deploy --tags manager --network rinkeby
```

Fund the manager with the amount we need to deploy contracts:

The task will convert the amount passed in GRT to wei before calling the contracts.

```
npx hardhat manager-deposit --amount <amount-in-grt> --network rinkeby
```

Deploy a number of TokenLock contracts using the Manager:

```
npx hardhat create-token-locks --deploy-file <deploy-file.csv> --result-file <result-file.csv> --owner-address <owner-address> --network rinkeby
```

Setup the Token Manager to allow default protocol functions:

```
npx hardhat manager-setup-auth --target-address <staking-address> --network rinkeby
```


