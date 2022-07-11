import PQueue from 'p-queue'
import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-ethers'
import { BigNumber, Contract, utils } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import CoinGecko from 'coingecko-api'
import { Block } from '@ethersproject/abstract-provider'
import * as GraphClient from '../.graphclient'
import {
  execute,
  GraphNetworkDocument,
  GraphNetworkQuery,
  TokenLockWalletsDocument,
  TokenLockWalletsQuery,
} from '../.graphclient'
import { ExecutionResult } from 'graphql'

const CoinGeckoClient = new CoinGecko()

// Types

interface ContractTokenData {
  address: string
  tokenAmount: BigNumber
}

type TokenLockWallet = Pick<
  GraphClient.TokenLockWallet,
  | 'id'
  | 'beneficiary'
  | 'managedAmount'
  | 'periods'
  | 'startTime'
  | 'endTime'
  | 'revocable'
  | 'releaseStartTime'
  | 'vestingCliffTime'
  | 'initHash'
  | 'txHash'
  | 'manager'
  | 'tokensReleased'
  | 'tokensWithdrawn'
  | 'tokensRevoked'
  | 'blockNumberCreated'
>
type GraphNetwork = Pick<GraphClient.GraphNetwork, 'id' | 'totalSupply'>

// Helpers

const toInt = (s) => parseInt(s) / 1e18
const toBN = (s: string): BigNumber => BigNumber.from(s)
const formatGRT = (n: BigNumber): string => utils.formatEther(n)
const formatRoundGRT = (n: BigNumber): string => formatGRT(n).split('.')[0]
const parseGRT = (n: string): BigNumber => utils.parseEther(n)
const toWei = (n: string): string => parseGRT(n).toString()
const prettyDate = (date: string) => {
  const n = parseInt(date)
  if (n === 0) return '0'
  const d = new Date(n * 1000)
  return d.toISOString().replace(/T/, ' ').replace(/\..+/, '')
}
const now = () => +new Date() / 1000

// Fixed data

const vestingListExchanges: TokenLockWallet[] = [
  {
    beneficiary: '0x0000000000000000000000000000000000000000',
    managedAmount: toWei('50000000'),
    periods: 48,
    startTime: '1522602000',
    endTime: '1648832400',
    revocable: 'Enabled',
    releaseStartTime: '1627146000',
    vestingCliffTime: '0',
    id: '0x0000000000000000000000000000000000000000',
    initHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    manager: '0x0000000000000000000000000000000000000000',
    tokensReleased: '0',
    tokensWithdrawn: '0',
    tokensRevoked: '0',
    blockNumberCreated: '0',
  },
  {
    beneficiary: '0x0000000000000000000000000000000000000000',
    managedAmount: toWei('8000000'),
    periods: 1,
    startTime: '1608224400',
    endTime: '1627146000',
    revocable: 'Disabled',
    releaseStartTime: '0',
    vestingCliffTime: '0',
    id: '0x0000000000000000000000000000000000000000',
    initHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    manager: '0x0000000000000000000000000000000000000000',
    tokensReleased: '0',
    tokensWithdrawn: '0',
    tokensRevoked: '0',
    blockNumberCreated: '0',
  },
  {
    beneficiary: '0x0000000000000000000000000000000000000000',
    managedAmount: toWei('59000000'),
    periods: 48,
    startTime: '1543683600',
    endTime: '1669914000',
    revocable: 'Enabled',
    releaseStartTime: '1627146000',
    vestingCliffTime: '0',
    id: '0x0000000000000000000000000000000000000000',
    initHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    manager: '0x0000000000000000000000000000000000000000',
    tokensReleased: '0',
    tokensWithdrawn: '0',
    tokensRevoked: '0',
    blockNumberCreated: '0',
  },
  {
    beneficiary: '0x0000000000000000000000000000000000000000',
    managedAmount: toWei('4000000'),
    periods: 1,
    startTime: '1608224400',
    endTime: '1627146000',
    revocable: 'Disabled',
    releaseStartTime: '0',
    vestingCliffTime: '0',
    id: '0x0000000000000000000000000000000000000000',
    initHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    manager: '0x0000000000000000000000000000000000000000',
    tokensReleased: '0',
    tokensWithdrawn: '0',
    tokensRevoked: '0',
    blockNumberCreated: '0',
  },
  {
    beneficiary: '0x0000000000000000000000000000000000000000',
    managedAmount: toWei('50000000'),
    periods: 48,
    startTime: '1527872400',
    endTime: '1654102800',
    revocable: 'Enabled',
    releaseStartTime: '1627146000',
    vestingCliffTime: '0',
    id: '0x0000000000000000000000000000000000000000',
    initHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    manager: '0x0000000000000000000000000000000000000000',
    tokensReleased: '0',
    tokensWithdrawn: '0',
    tokensRevoked: '0',
    blockNumberCreated: '0',
  },
]

// Network

async function getNetworkData(blockNumber: number): Promise<GraphNetwork> {
  const result: ExecutionResult<GraphNetworkQuery> = await execute(GraphNetworkDocument, { blockNumber })
  return result.data.graphNetwork
}

async function getWallets(skip = 0, blockNumber: number): Promise<TokenLockWallet[]> {
  const result: ExecutionResult<TokenLockWalletsQuery> = await execute(TokenLockWalletsDocument, { blockNumber, skip })
  return result.data ? result.data.tokenLockWallets : []
}

async function getAllItems(fetcher, blockNumber: number): Promise<any[]> {
  let skip = 0
  let allItems = []
  while (true) {
    const items = await fetcher(skip, blockNumber)
    allItems = [...allItems, ...items]
    if (items.length < 1000) {
      break
    }
    skip += 1000
  }
  return allItems
}

// Calculations

function getAvailableAmount(wallet: TokenLockWallet, blockTimestamp: number): BigNumber {
  const current = blockTimestamp
  const startTime = parseInt(wallet.startTime)
  const endTime = parseInt(wallet.endTime)
  const managedAmount = toBN(wallet.managedAmount)

  if (current < startTime) {
    return toBN('0')
  }
  if (current > parseInt(wallet.endTime)) {
    return managedAmount
  }

  const sinceStartTime = current > startTime ? current - startTime : 0
  const periodDuration = (endTime - startTime) / wallet.periods
  const currentPeriod = Math.floor(sinceStartTime / periodDuration + 1)
  const passedPeriods = currentPeriod - 1
  const amountPerPeriod = managedAmount.div(wallet.periods)

  return amountPerPeriod.mul(passedPeriods)
}

// Summaries

class TokenSummary {
  totalManaged: BigNumber
  totalReleased: BigNumber
  totalAvailable: BigNumber
  totalUsed: BigNumber
  totalCount: number
  contractsReleased: ContractTokenData[]
  contractsInProtocol: ContractTokenData[]
  block: Block

  constructor(block: Block) {
    this.totalManaged = BigNumber.from(0)
    this.totalReleased = BigNumber.from(0)
    this.totalAvailable = BigNumber.from(0)
    this.totalUsed = BigNumber.from(0)
    this.totalCount = 0
    this.contractsReleased = []
    this.contractsInProtocol = []
    this.block = block
  }

  public async addWallet(wallet: TokenLockWallet, contract?: Contract) {
    const availableAmount = getAvailableAmount(wallet, this.block.timestamp)
    const tokensReleased = toBN(wallet.tokensReleased)

    this.totalManaged = this.totalManaged.add(toBN(wallet.managedAmount))
    this.totalAvailable = this.totalAvailable.add(availableAmount)
    this.totalReleased = this.totalReleased.add(tokensReleased)
    this.totalCount++

    if (tokensReleased.gt(0)) {
      this.contractsReleased.push({ address: wallet.id, tokenAmount: tokensReleased })
    }

    if (contract) {
      const [usedAmount] = await Promise.all([contract.usedAmount({ blockTag: this.block.number })])
      if (usedAmount.gt(0)) {
        this.totalUsed = this.totalUsed.add(usedAmount)
        this.contractsInProtocol.push({ address: contract.address, tokenAmount: usedAmount })
      }
    }
  }

  private showContracts(contracts: ContractTokenData[]) {
    for (const contractTokenData of contracts) {
      console.log(`  ${contractTokenData.address}: ${formatRoundGRT(contractTokenData.tokenAmount)}`)
    }
  }

  public show(detail = false) {
    console.log(`= Managed: ${formatRoundGRT(this.totalManaged)} [n:${this.totalCount}]`)
    console.log(
      `- Available (${this.totalAvailable.mul(100).div(this.totalManaged)}%):`,
      formatRoundGRT(this.totalAvailable),
    )
    console.log(
      `-- Released (${this.totalReleased.mul(100).div(this.totalAvailable)}%): ${formatRoundGRT(
        this.totalReleased,
      )} [n:${this.contractsReleased.length}]`,
    )
    if (detail) {
      this.showContracts(this.contractsReleased)
    }
    if (this.totalUsed.gt(0)) {
      console.log(`- Used ${formatRoundGRT(this.totalUsed)} [n:${this.contractsInProtocol.length}]`)
      if (detail) {
        this.showContracts(this.contractsInProtocol)
      }
    }
  }
}

// -- Tasks --

task('contracts:list', 'List all token lock contracts')
  .addOptionalParam('blocknumber', 'Block number to list contracts on')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const blockNumber = taskArgs.blocknumber ? parseInt(taskArgs.blocknumber) : 'latest'
    const block = await hre.ethers.provider.getBlock(blockNumber)
    console.log('Block:', block.number, '/', new Date(block.timestamp * 1000).toDateString(), '\n')
    const allWallets = (await getAllItems(getWallets, block.number)) as TokenLockWallet[]

    const headers = [
      'beneficiary',
      'managedAmount',
      'startTime',
      'endTime',
      'periods',
      'revocable',
      'releaseStartTime',
      'vestingCliffTime',
      'contractAddress',
      'initHash',
      'txHash',
      'manager',
      'tokensReleased',
      'tokensWithdrawn',
      'tokensAvailable',
      'tokensRevoked',
      'blockNumberCreated',
    ].join(',')
    console.log(headers)

    for (const wallet of allWallets) {
      const csv = [
        wallet.beneficiary,
        toInt(wallet.managedAmount),
        wallet.startTime,
        wallet.endTime,
        wallet.periods,
        wallet.revocable,
        wallet.releaseStartTime,
        wallet.vestingCliffTime,
        wallet.id,
        wallet.initHash,
        wallet.txHash,
        wallet.manager,
        toInt(wallet.tokensReleased),
        toInt(wallet.tokensWithdrawn),
        formatRoundGRT(getAvailableAmount(wallet, block.timestamp)),
        toInt(wallet.tokensRevoked),
        wallet.blockNumberCreated,
      ].join(',')
      console.log(csv)
    }
  })

task('contracts:summary', 'Show summary of balances')
  .addOptionalParam('blocknumber', 'Block number to calculate balances on')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    // Fetch contracts
    const blockNumber = taskArgs.blocknumber ? parseInt(taskArgs.blocknumber) : 'latest'
    const block = await hre.ethers.provider.getBlock(blockNumber)
    console.log('Block:', block.number, '/', new Date(block.timestamp * 1000).toDateString(), '\n')
    const allWallets = (await getAllItems(getWallets, block.number)) as TokenLockWallet[]
    const revocableWallets = allWallets.filter((wallet) => wallet.revocable === 'Enabled')

    // Calculate summaries (for all vestings)
    const summary: TokenSummary = new TokenSummary(block)
    for (const wallet of allWallets) {
      await summary.addWallet(wallet)
    }

    // Calculate summaries (for revocable vestings)
    const queue = new PQueue({ concurrency: 10 })
    const revocableSummary: TokenSummary = new TokenSummary(block)
    revocableWallets.map(async (wallet) => {
      queue.add(async () => {
        const contract = await hre.ethers.getContractAt('GraphTokenLockWallet', wallet.id)
        await revocableSummary.addWallet(wallet, contract)
      })
    })
    await queue.onIdle()

    // Network data
    const graphNetwork = await getNetworkData(block.number)

    // Foundation and Edge & Node contracts
    const vestingEAN = await hre.ethers.getContractAt(
      'GraphTokenLockSimple',
      '0x5785176048BEB00DcB6eC84A604d76E30E0666db',
    )
    const vestingGRT = await hre.ethers.getContractAt(
      'GraphTokenLockSimple',
      '0x32Ec7A59549b9F114c9D7d8b21891d91Ae7F2ca1',
    )
    const [managedAmountEAN, managedAmountGRT, availableAmountEAN, availableAmountGRT] = await Promise.all([
      await vestingEAN.managedAmount({ blockTag: block.number }),
      await vestingGRT.managedAmount({ blockTag: block.number }),
      await vestingEAN.availableAmount({ blockTag: block.number }),
      await vestingGRT.availableAmount({ blockTag: block.number }),
    ])

    // Exchange locked
    let managedAmountExchanges = vestingListExchanges
      .map((vesting) => toBN(vesting.managedAmount))
      .reduce((a, b) => a.add(b), toBN('0'))
    let availableAmountExchanges = vestingListExchanges
      .map((vesting) => getAvailableAmount(vesting, block.timestamp))
      .reduce((a, b) => a.add(b), toBN('0'))
    managedAmountExchanges = managedAmountExchanges.add(toWei('283333334'))
    availableAmountExchanges = availableAmountExchanges.add(toWei('150000000'))

    // General summary
    const totalSupply = toBN(graphNetwork.totalSupply)
    const totalLockedAll = summary.totalManaged.sub(summary.totalAvailable)
    const totalLockedEAN = managedAmountEAN.sub(availableAmountEAN)
    const totalLockedGRT = managedAmountGRT.sub(availableAmountGRT)
    const totalLockedExchanges = managedAmountExchanges.sub(availableAmountExchanges)
    const totalLocked = totalLockedAll.add(totalLockedEAN).add(totalLockedGRT).add(totalLockedExchanges)

    console.log('General Summary')
    console.log('---------------')
    console.log('= Total Supply:\t', formatRoundGRT(totalSupply))
    console.log('- Total Locked:\t', formatRoundGRT(totalLocked))
    console.log('-- General:\t', formatRoundGRT(totalLockedAll), '/', formatRoundGRT(summary.totalManaged))
    console.log('-- Edge & Node:\t', formatRoundGRT(totalLockedEAN), '/', formatRoundGRT(managedAmountEAN))
    console.log('-- Foundation:\t', formatRoundGRT(totalLockedGRT), '/', formatRoundGRT(managedAmountGRT))
    console.log('-- Exchanges:\t', formatRoundGRT(totalLockedExchanges), '/', formatRoundGRT(managedAmountExchanges))
    console.log('- Total Free:\t', formatRoundGRT(totalSupply.sub(totalLocked)))
    console.log('')
    summary.show()

    // Summary of revocable contracts
    console.log('\nRevocable Summary')
    console.log('-----------------')
    revocableSummary.show(false)
  })

task('contracts:show', 'Show info about an specific contract')
  .addPositionalParam('address', 'Contract address to show')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const contractAddress = taskArgs.address
    const contract = await hre.ethers.getContractAt('GraphTokenLockWallet', contractAddress)

    const [
      managedAmount,
      availableAmount,
      releasableAmount,
      releasedAmount,
      usedAmount,
      currentBalance,
      amountPerPeriod,
      surplusAmount,
      vestedAmount,
    ] = await Promise.all([
      await contract.managedAmount(),
      await contract.availableAmount(),
      await contract.releasableAmount(),
      await contract.releasedAmount(),
      await contract.usedAmount(),
      await contract.currentBalance(),
      await contract.amountPerPeriod(),
      await contract.surplusAmount(),
      await contract.vestedAmount(),
    ]).then((results) => results.map((e) => formatRoundGRT(e)))

    const [startTime, endTime, periods, currentPeriod, periodDuration, revocable, owner, manager] = await Promise.all([
      contract.startTime(),
      contract.endTime(),
      contract.periods(),
      contract.currentPeriod(),
      contract.periodDuration(),
      contract.revocable(),
      contract.owner(),
      contract.manager(),
    ])
    const nextTime = startTime.add(currentPeriod.mul(periodDuration))

    console.log(`# Contract at ${contractAddress}`)
    console.log('\n## Control')
    console.log(`  Owner: ${owner}`)
    console.log(`  Manager: ${manager}`)
    console.log('\n## Schedule')
    console.log(`  ${prettyDate(startTime)} -> ${prettyDate(endTime)} <@${periods} periods>`)
    console.log(`  Next: ${prettyDate(nextTime)} >> ${amountPerPeriod}`)
    console.log(`  Revocable: ${revocable}`)
    console.log('  (=) Managed:', managedAmount)
    console.log('   - Available: ', availableAmount)
    console.log('   - Unvested: ', formatRoundGRT(parseGRT(managedAmount).sub(parseGRT(vestedAmount))))
    console.log('   - Releaseable: ', releasableAmount)
    console.log('\n## Position')
    console.log('  (*) Managed:', managedAmount)
    console.log('  (=) Balance:', currentBalance)
    console.log('  (<) Released: ', releasedAmount)
    console.log('  (>) Used: ', usedAmount)
    console.log('  (+) Surplus: ', surplusAmount)
  })

interface CoinPrice {
  date: number
  price: number
}

async function getCoinPrice(timeIndex: number): Promise<CoinPrice> {
  // Scan for a price close to the desired datetime
  const buffer = 1800
  const params = {
    from: timeIndex - buffer,
    to: timeIndex + buffer,
  }
  const coin = await CoinGeckoClient.coins.fetchMarketChartRange('the-graph', params)
  const priceInstance = coin.data.prices[0]
  return {
    date: priceInstance[0] / 1000,
    price: priceInstance[1],
  }
}

task('contracts:schedule', 'Show schedule of a set of contracts').setAction(
  async (_, hre: HardhatRuntimeEnvironment) => {
    const contractAddresses = [
      '0xc2525d1326c0d38c9fae42a663b9ec32a6338948',
      '0xc4307eb08c3fd10c1f7de94e6db34371df18f06f',
      '0x4c57e626f38a95220eefa8fc2f44ef5e4bbc7b9e',
      '0x56f256fdd8899fd3f08b731431c61e2df8f99625',
      '0x60abb93f12ebbbfd84c8cb52df8c7b3c26aea170',
      '0x1d535b18ee9b8453cfef723ecd96720c3322de8c',
      '0x27c26eed0a9e09d9662eb154f52b55153d2ed705',
    ]

    // Print release schedule for every contract
    for (const contractAddress of contractAddresses) {
      // Read contract data
      const contract = await hre.ethers.getContractAt('GraphTokenLockWallet', contractAddress)
      const [startTime, endTime, periods, amountPerPeriod] = await Promise.all([
        contract.startTime(),
        contract.endTime(),
        contract.periods(),
        contract.amountPerPeriod(),
      ])

      // Scan every period
      const duration = endTime.sub(startTime)
      const durationPerPeriod = duration.div(periods)
      for (let i = 1; i <= periods; i++) {
        const timeIndex = startTime.add(durationPerPeriod.mul(i))
        const output = [contractAddress, i, prettyDate(timeIndex.toString()), formatGRT(amountPerPeriod)]
        if (timeIndex < now()) {
          try {
            const coinPrice = await getCoinPrice(timeIndex.toNumber())
            output.push(coinPrice.price)
            output.push(prettyDate(coinPrice.date.toString()))
            console.log(output.join(','))
          } catch (e) {
            console.log(e)
            console.log('Error while fetching coin price')
            console.log(output)
            break
          }
        } else {
          output.push('')
          output.push('')
        }
      }
    }
  },
)
