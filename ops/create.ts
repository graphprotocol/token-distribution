import PQueue from 'p-queue'
import fs from 'fs'
import consola from 'consola'
import inquirer from 'inquirer'
import { utils, BigNumber, Event, ContractTransaction, ContractReceipt, Contract, ContractFactory } from 'ethers'

import { NonceManager } from '@ethersproject/experimental'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { boolean } from 'hardhat/internal/core/params/argumentTypes'

const { getAddress, keccak256, formatEther, parseEther } = utils

const logger = consola.create({})

enum Revocability {
  NotSet,
  Enabled,
  Disabled,
}

interface TokenLockConfigEntry {
  owner?: string
  beneficiary: string
  managedAmount: BigNumber
  startTime: string
  endTime: string
  periods: string
  revocable: Revocability
  releaseStartTime: string
  vestingCliffTime: string
  salt?: string
  txHash?: string
  contractAddress?: string
}

interface TokenLockDeployEntry extends TokenLockConfigEntry {
  salt: string
  txHash: string
  contractAddress: string
}

const askConfirm = async () => {
  const res = await inquirer.prompt({
    name: 'confirm',
    type: 'confirm',
    message: `Are you sure you want to proceed?`,
  })
  return res.confirm
}

const loadDeployData = (filepath: string): TokenLockConfigEntry[] => {
  const data = fs.readFileSync(__dirname + filepath, 'utf8')
  const entries = data.split('\n').map((e) => e.trim())
  entries.shift() // remove the title from the csv
  return entries
    .filter((entryData) => !!entryData)
    .map((entryData) => {
      const entry = entryData.split(',')
      return {
        beneficiary: entry[0],
        managedAmount: parseEther(entry[1]),
        startTime: entry[2],
        endTime: entry[3],
        periods: entry[4],
        revocable: parseInt(entry[5]),
        releaseStartTime: entry[6],
        vestingCliffTime: entry[7],
      }
    })
}

const deployEntryToCSV = (entry: TokenLockDeployEntry) => {
  return [
    entry.beneficiary,
    formatEther(entry.managedAmount),
    entry.startTime,
    entry.endTime,
    entry.periods,
    entry.revocable,
    entry.releaseStartTime,
    entry.contractAddress,
    entry.salt,
    entry.txHash,
  ].join(',')
}

const saveDeployResult = (filepath: string, entry: TokenLockDeployEntry) => {
  const line = deployEntryToCSV(entry) + '\n'
  fs.writeFileSync(filepath, line, {
    flag: 'a+',
  })
}

const checkAddresses = (entries: TokenLockConfigEntry[]): boolean => {
  for (const entry of entries) {
    try {
      getAddress(entry.beneficiary.trim())
    } catch (err) {
      logger.error(`Invalid csv entry: Address: ${entry.beneficiary}`)
      return false
    }
  }
  return true
}

const getTotalAmount = (entries: TokenLockConfigEntry[]): BigNumber => {
  return entries.reduce((total, entry) => total.add(entry.managedAmount), BigNumber.from(0))
}

const prettyDate = (date: string) => {
  const n = parseInt(date)
  if (n === 0) return '0'
  const d = new Date(n * 1000)
  return d.toLocaleString()
}

const prettyConfigEntry = (config: TokenLockConfigEntry) => {
  return `
    Beneficiary: ${config.beneficiary}
    Amount: ${formatEther(config.managedAmount)} GRT
    Starts: ${config.startTime} (${prettyDate(config.startTime)})
    Ends: ${config.endTime} (${prettyDate(config.endTime)})
    Periods: ${config.periods}
    Revocable: ${config.revocable}
    ReleaseCliff: ${config.releaseStartTime} (${prettyDate(config.releaseStartTime)})
    VestingCliff: ${config.vestingCliffTime} (${prettyDate(config.vestingCliffTime)})
    -> ContractAddress: ${config.contractAddress}
  `
}

const prettyEnv = async (hre: HardhatRuntimeEnvironment) => {
  const { deployer } = await hre.getNamedAccounts()

  const provider = hre.ethers.provider

  const balance = await provider.getBalance(deployer)
  const chainId = (await provider.getNetwork()).chainId
  const nonce = await provider.getTransactionCount(deployer)

  const gas = hre.network.config.gas
  const gasPrice = hre.network.config.gasPrice

  return `
  Wallet: address=${deployer} chain=${chainId} nonce=${nonce} balance=${formatEther(balance)}
  Gas settings: gas=${gas} gasPrice=${gasPrice}
  `
}

const calculateSalt = async (
  hre: HardhatRuntimeEnvironment,
  entry: TokenLockConfigEntry,
  managerAddress: string,
  tokenAddress: string,
) => {
  const factory = await getContractFactory(hre, 'GraphTokenLockWallet')

  return keccak256(
    factory.interface.encodeFunctionData(
      'initialize(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint8)',
      [
        managerAddress,
        entry.owner,
        entry.beneficiary,
        tokenAddress,
        entry.managedAmount,
        entry.startTime,
        entry.endTime,
        entry.periods,
        entry.releaseStartTime,
        entry.vestingCliffTime,
        entry.revocable,
      ],
    ),
  )
}

const getContractFactory = async (hre: HardhatRuntimeEnvironment, name: string) => {
  const artifact = await hre.deployments.getArtifact(name)
  return new ContractFactory(artifact.abi, artifact.bytecode)
}

const getDeployContractAddresses = async (entries: TokenLockConfigEntry[], manager: Contract) => {
  const masterCopy = await manager.masterCopy()
  for (const entry of entries) {
    const contractAddress = await manager.getDeploymentAddress(entry.salt, masterCopy)
    const deployEntry = { ...entry, salt: entry.salt, txHash: '', contractAddress }
    logger.log(prettyConfigEntry(deployEntry))
  }
}

const populateEntries = async (
  hre: HardhatRuntimeEnvironment,
  entries: TokenLockConfigEntry[],
  managerAddress: string,
  tokenAddress: string,
  ownerAddress: string,
) => {
  const results = []
  for (const entry of entries) {
    entry.owner = ownerAddress
    entry.salt = await calculateSalt(hre, entry, managerAddress, tokenAddress)
    results.push(entry)
  }
  return results
}

const getTokenLockManagerOrFail = async (hre: HardhatRuntimeEnvironment) => {
  const deployment = await hre.deployments.get('GraphTokenLockManager')
  if (!deployment.address) {
    logger.error('GraphTokenLockManager address not found')
    process.exit(1)
  }

  const manager = await hre.ethers.getContractAt('GraphTokenLockManager', deployment.address)
  try {
    await manager.deployed()
  } catch (err) {
    logger.error('GraphTokenLockManager not deployed at', manager.address)
    process.exit(1)
  }

  return manager
}

const waitTransaction = async (tx: ContractTransaction, confirmations = 1): Promise<ContractReceipt> => {
  logger.log(`> Transaction sent: ${tx.hash}`)
  const receipt = await tx.wait(confirmations)
  receipt.status ? logger.success(`Transaction succeeded: ${tx.hash}`) : logger.warn(`Transaction failed: ${tx.hash}`)
  return receipt
}

// -- Tasks --

task('create-token-locks', 'Create token lock contracts from file')
  .addParam('deployFile', 'File from where to read the deploy config')
  .addParam('resultFile', 'File where to save results')
  .addParam('ownerAddress', 'Owner address of token lock contracts')
  .addOptionalParam('dryRun', 'Get the deterministic contract addresses but do not deploy', false, boolean)
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    // Get contracts
    const manager = await getTokenLockManagerOrFail(hre)

    // Prepare
    logger.log(await prettyEnv(hre))

    const tokenAddress = await manager.token()

    logger.info('Deploying token lock contracts...')
    logger.log(`> GraphToken: ${tokenAddress}`)
    logger.log(`> GraphTokenLockMasterCopy: ${await manager.masterCopy()}`)
    logger.log(`> GraphTokenLockManager: ${manager.address}`)

    // Load config entries
    logger.log('')
    logger.info('Verifying deployment data...')
    let entries = loadDeployData('/' + taskArgs.deployFile)
    if (!checkAddresses(entries)) {
      process.exit(1)
    }
    logger.success(`Total of ${entries.length} entries. All good!`)

    // Load deployed entries
    let deployedEntries = loadDeployData('/' + taskArgs.resultFile)

    // Populate entries
    entries = await populateEntries(hre, entries, manager.address, tokenAddress, taskArgs.ownerAddress)
    deployedEntries = await populateEntries(hre, deployedEntries, manager.address, tokenAddress, taskArgs.ownerAddress)

    // Filter out already deployed ones
    entries = entries.filter((entry) => !deployedEntries.find((deployedEntry) => deployedEntry.salt === entry.salt))
    logger.success(`Total of ${entries.length} entries after removing already deployed. All good!`)
    if (entries.length === 0) {
      logger.warn('Nothing new to deploy')
      process.exit(1)
    }

    // Dry running
    if (taskArgs.dryRun) {
      await getDeployContractAddresses(entries, manager)
      process.exit(0)
    }

    // Check if Manager is funded
    logger.log('')
    logger.info('Verifying balances...')
    const grt = await hre.ethers.getContractAt('ERC20', tokenAddress)
    const totalAmount = getTotalAmount(entries)
    const currentBalance = await grt.balanceOf(manager.address)
    logger.log(`> Amount to distribute:  ${formatEther(totalAmount)} GRT`)
    logger.log(`> Amount in the Manager: ${formatEther(currentBalance)} GRT`)
    if (currentBalance.lt(totalAmount)) {
      logger.error(`GraphTokenLockManager is underfunded. Deposit more funds into ${manager.address}`)
      process.exit(1)
    }
    logger.success('Manager has enough tokens to fund contracts')

    // Summary
    if (!(await askConfirm())) {
      logger.log('Cancelled')
      process.exit(1)
    }

    // Deploy contracts
    const accounts = await hre.ethers.getSigners()
    const queue = new PQueue({ concurrency: 4 })
    const nonceManager = new NonceManager(accounts[0]) // Use NonceManager to send concurrent txs

    for (const entry of entries) {
      queue.add(async () => {
        logger.log('')
        logger.info(`Creating contract...`)
        logger.log(prettyConfigEntry(entry))

        // Deploy
        const tx = await manager
          .connect(nonceManager)
          .createTokenLockWallet(
            entry.owner,
            entry.beneficiary,
            entry.managedAmount,
            entry.startTime,
            entry.endTime,
            entry.periods,
            entry.releaseStartTime,
            entry.vestingCliffTime,
            entry.revocable,
          )
        const receipt = await waitTransaction(tx)
        const event: Event = receipt.events[0]
        const contractAddress = event.args['proxy']
        logger.success(`Deployed: ${contractAddress} (${entry.salt})`)

        // Save result
        const deployResult = { ...entry, salt: entry.salt, txHash: tx.hash, contractAddress }
        saveDeployResult('ops/' + taskArgs.resultFile, deployResult)
      })
    }
    await queue.onIdle()
  })

task('manager-setup-auth', 'Setup default authorized functions in the manager')
  .addParam('targetAddress', 'Target address for function calls')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    // Get contracts
    const manager = await getTokenLockManagerOrFail(hre)

    // Prepare
    logger.log(await prettyEnv(hre))

    // Validations
    try {
      getAddress(taskArgs.targetAddress)
    } catch (err) {
      logger.error(`Invalid target address ${taskArgs.targetAddress}`)
      process.exit(1)
    }

    // Setup authorized functions
    const signatures = [
      'stake(uint256)',
      'unstake(uint256)',
      'withdraw()',
      'delegate(address,uint256)',
      'undelegate(address,uint256)',
      'withdrawDelegated(address,address)',
      'setDelegationParameters(uint32 ,uint32,uint32)',
      'setOperator(address,bool)',
    ]

    logger.info('The following signatures will be authorized:')
    logger.info(signatures)

    if (await askConfirm()) {
      // Setup authorized functions
      logger.info('Setup authorized functions...')
      const targets = Array(signatures.length).fill(taskArgs.targetAddress)
      const tx1 = await manager.setAuthFunctionCallMany(signatures, targets)
      await waitTransaction(tx1)
      logger.success('Done!\n')

      // Setup authorized token destinations
      logger.info('Setup authorized destinations...')
      const tx2 = await manager.addTokenDestination(taskArgs.targetAddress)
      await waitTransaction(tx2)
    }
  })

task('manager-deposit', 'Deposit fund into the manager')
  .addParam('amount', 'Amount to deposit in GRT')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    // Get contracts
    const manager = await getTokenLockManagerOrFail(hre)

    // Prepare
    logger.log(await prettyEnv(hre))

    const tokenAddress = await manager.token()

    logger.info('Using:')
    logger.log(`> GraphToken: ${tokenAddress}`)
    logger.log(`> GraphTokenLockMasterCopy: ${await manager.masterCopy()}`)
    logger.log(`> GraphTokenLockManager: ${manager.address}`)

    // Deposit funds
    logger.log(`You are depositing ${taskArgs.amount} into ${manager.address}...`)
    if (await askConfirm()) {
      const weiAmount = parseEther(taskArgs.amount)

      logger.log('Approve...')
      const grt = await hre.ethers.getContractAt('ERC20', tokenAddress)
      const tx1 = await grt.approve(manager.address, weiAmount)
      await waitTransaction(tx1)

      logger.log('Deposit...')
      const tx2 = await manager.deposit(weiAmount)
      await waitTransaction(tx2)
    }
  })

task('manager-withdraw', 'Withdraw fund from the manager')
  .addParam('amount', 'Amount to deposit in GRT')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    // Get contracts
    const manager = await getTokenLockManagerOrFail(hre)

    // Prepare
    logger.log(await prettyEnv(hre))

    const tokenAddress = await manager.token()

    logger.info('Using:')
    logger.log(`> GraphToken: ${tokenAddress}`)
    logger.log(`> GraphTokenLockMasterCopy: ${await manager.masterCopy()}`)
    logger.log(`> GraphTokenLockManager: ${manager.address}`)

    // Withdraw funds
    logger.log(`You are withdrawing ${taskArgs.amount} from ${manager.address}...`)
    if (await askConfirm()) {
      const weiAmount = parseEther(taskArgs.amount)

      logger.log('Deposit...')
      const tx = await manager.withdraw(weiAmount)
      await waitTransaction(tx)
    }
  })

task('manager-balance', 'Get current manager balance').setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
  // Get contracts
  const manager = await getTokenLockManagerOrFail(hre)

  // Prepare
  logger.log(await prettyEnv(hre))

  const tokenAddress = await manager.token()

  logger.info('Using:')
  logger.log(`> GraphToken: ${tokenAddress}`)
  logger.log(`> GraphTokenLockMasterCopy: ${await manager.masterCopy()}`)
  logger.log(`> GraphTokenLockManager: ${manager.address}`)

  const grt = await hre.ethers.getContractAt('ERC20', tokenAddress)
  const balance = await grt.balanceOf(manager.address)
  logger.log('Current Manager balance is ', formatEther(balance))
})
