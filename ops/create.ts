import fs from 'fs'
import consola from 'consola'
import inquirer from 'inquirer'
import { utils, BigNumber, Event, providers } from 'ethers'

import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

import { Erc20 } from '../build/typechain/contracts/Erc20'
import { GraphTokenLockWalletFactory } from '../build/typechain/contracts/GraphTokenLockWalletFactory'
import { GraphTokenLockManager } from '../build/typechain/contracts/GraphTokenLockManager'

const { getAddress, keccak256, formatEther, parseEther } = utils

const logger = consola.create({})

interface TokenLockConfigEntry {
  owner?: string
  beneficiary: string
  managedAmount: BigNumber
  startTime: string
  endTime: string
  periods: string
  revocable: boolean
  releaseStartTime: string
  salt?: string
  txHash?: string
  contractAddress?: string
}

interface TokenLockDeployEntry extends TokenLockConfigEntry {
  salt: string
  txHash: string
  contractAddress: string
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
        revocable: parseInt(entry[5]) === 1,
        releaseStartTime: entry[6],
      }
    })
}

const saveDeployResult = (filepath: string, entry: TokenLockDeployEntry) => {
  const line =
    [
      entry.beneficiary,
      formatEther(entry.managedAmount),
      entry.startTime,
      entry.endTime,
      entry.periods,
      entry.revocable ? 1 : 0,
      entry.releaseStartTime,
      entry.contractAddress,
      entry.salt,
      entry.txHash,
    ].join(',') + '\n'
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
    Release: ${config.releaseStartTime} (${prettyDate(config.releaseStartTime)})
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

const calculateSalt = (entry: TokenLockConfigEntry, managerAddress: string, tokenAddress: string) => {
  const factory = new GraphTokenLockWalletFactory()
  return keccak256(
    factory.interface.encodeFunctionData(
      'initialize(address,address,address,address,uint256,uint256,uint256,uint256,uint256,bool)',
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
        entry.revocable,
      ],
    ),
  )
}

const getDeployContractAddresses = async (entries: TokenLockConfigEntry[], manager: GraphTokenLockManager) => {
  const masterCopy = await manager.masterCopy()

  for (const entry of entries) {
    const contractAddress = await manager.getDeploymentAddress(entry.salt, masterCopy)
    console.log(contractAddress)
  }
}

const populateEntries = (
  entries: TokenLockConfigEntry[],
  managerAddress: string,
  tokenAddress: string,
  ownerAddress: string,
) => {
  const results = []
  for (const entry of entries) {
    entry.owner = ownerAddress
    entry.salt = calculateSalt(entry, managerAddress, tokenAddress)
    results.push(entry)
  }
  return results
}

task('create-token-locks', 'Create token lock contracts from file')
  .addParam('deployFile', 'File from where to read the deploy config')
  .addParam('resultFile', 'File where to save results')
  .addParam('ownerAddress', 'Owner address of token lock contracts')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    // Get contracts
    const deployment = await hre.deployments.get('GraphTokenLockManager')
    if (!deployment.address) {
      logger.error('GraphTokenLockManager address not found')
      process.exit(1)
    }

    const manager = (await hre.ethers.getContractAt(
      'GraphTokenLockManager',
      deployment.address,
    )) as GraphTokenLockManager
    try {
      await manager.deployed()
    } catch (err) {
      logger.error('GraphTokenLockManager not deployed at', manager.address)
      process.exit(1)
    }

    // Deploy
    logger.log(await prettyEnv(hre))

    logger.info('Deploying token lock contracts...')
    logger.log(`> GraphToken: ${await manager.token()}`)
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
    entries = populateEntries(entries, manager.address, await manager.token(), taskArgs.ownerAddress)
    deployedEntries = populateEntries(deployedEntries, manager.address, await manager.token(), taskArgs.ownerAddress)

    // Filter out already deployed ones
    entries = entries.filter((entry) => !deployedEntries.find((deployedEntry) => deployedEntry.salt === entry.salt))
    logger.success(`Total of ${entries.length} entries after removing already deployed. All good!`)
    if (entries.length === 0) {
      logger.warn('Nothing new to deploy')
      process.exit(1)
    }

    // Check if Manager is funded
    logger.log('')
    logger.info('Verifying balances...')
    const grt = (await hre.ethers.getContractAt('ERC20', await manager.token())) as Erc20
    const totalAmount = getTotalAmount(entries)
    const currentBalance = await grt.balanceOf(manager.address)
    logger.log(`> Amount to distribute:  ${formatEther(totalAmount)} GRT`)
    logger.log(`> Amount in the Manager: ${formatEther(currentBalance)} GRT`)
    if (currentBalance.lt(totalAmount)) {
      logger.error(`GraphTokenLockManager is underfunded. Deposit more funds into ${manager.address}`)
      process.exit(1)
    }
    logger.success('Manager has enough tokens to fund contracts')

    // TODO: add a summary and confirmation to deploy
    // TODO: support resuming

    for (const entry of entries) {
      logger.log('')
      logger.info(`Creating contract...`)
      logger.log(prettyConfigEntry(entry))

      // Deploy
      const tx = await manager.createTokenLockWallet(
        entry.owner,
        entry.beneficiary,
        entry.managedAmount,
        entry.startTime,
        entry.endTime,
        entry.periods,
        entry.releaseStartTime,
        entry.revocable,
      )
      logger.log(`Transaction sent: ${tx.hash}`)
      const receipt = await tx.wait()
      logger.log(`Transaction mined: ${tx.hash}`)
      const event: Event = receipt.events[0]
      const contractAddress = event.args['proxy']
      logger.success('Deployed:', contractAddress)

      // Save result
      const deployResult = { ...entry, salt: entry.salt, txHash: tx.hash, contractAddress }
      saveDeployResult('ops/' + taskArgs.resultFile, deployResult)
    }
  })
