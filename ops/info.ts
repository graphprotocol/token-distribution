import axios from 'axios'
import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-ethers'
import { BigNumber, Contract, utils } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

const TOKEN_DIST_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/graphprotocol/token-distribution'

interface DeployedTokenLockWallet {
  beneficiary: string
  managedAmount: string
  periods: number
  startTime: string
  endTime: string
  revocable: string
  releaseStartTime: string
  vestingCliffTime: string
  id: string
  initHash: string
  txHash: string
  tokensReleased: string
  tokensWithdrawn: string
}

interface ContractTokenData {
  address: string
  tokenAmount: BigNumber
}

const toInt = (s) => parseInt(s) / 1e18
const toBN = (s: string): BigNumber => BigNumber.from(s)
const formatGRT = (n: BigNumber): string => utils.formatEther(n)
const parseGRT = (n: string): BigNumber => utils.parseEther(n)
const prettyDate = (date: string) => {
  const n = parseInt(date)
  if (n === 0) return '0'
  const d = new Date(n * 1000)
  return d.toLocaleString()
}

async function getWallets(skip = 0): Promise<DeployedTokenLockWallet> {
  const query = `{
    tokenLockWallets (
        first: 1000, 
        skip: ${skip},
        orderBy: "id"
    ) {
      id
      beneficiary
      managedAmount
      periods
      startTime
      endTime
      revocable
      releaseStartTime
      vestingCliffTime
      initHash
      txHash
      tokensReleased
      tokensWithdrawn
    }
  }
`
  const res = await axios.post(TOKEN_DIST_SUBGRAPH, { query })
  return res.data.data.tokenLockWallets
}

async function getAllItems(fetcher): Promise<any[]> {
  let skip = 0
  let allItems = []
  while (true) {
    const items = await fetcher(skip)
    allItems = [...allItems, ...items]
    if (items.length < 1000) {
      break
    }
    skip += 1000
  }
  return allItems
}

function getAvailableAmount(wallet: DeployedTokenLockWallet): BigNumber {
  const current = Math.round(+new Date() / 1000)
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

class TokenSummary {
  totalManaged: BigNumber
  totalReleased: BigNumber
  totalAvailable: BigNumber
  totalUsed: BigNumber
  totalCount: number
  totalCountReleased: number
  contractsReleased: ContractTokenData[]
  contractsInProtocol: ContractTokenData[]

  constructor() {
    this.totalManaged = BigNumber.from(0)
    this.totalReleased = BigNumber.from(0)
    this.totalAvailable = BigNumber.from(0)
    this.totalUsed = BigNumber.from(0)
    this.totalCount = 0
    this.totalCountReleased = 0
    this.contractsReleased = []
    this.contractsInProtocol = []
  }

  public async addWallet(wallet: DeployedTokenLockWallet, contract?: Contract) {
    const availableAmount = getAvailableAmount(wallet)
    this.totalManaged = this.totalManaged.add(toBN(wallet.managedAmount))
    this.totalAvailable = this.totalAvailable.add(availableAmount)

    const tokensReleased = toBN(wallet.tokensReleased)
    this.totalReleased = this.totalReleased.add(tokensReleased)
    if (tokensReleased.gt(0)) {
      this.contractsReleased.push({ address: wallet.id, tokenAmount: tokensReleased })
    }

    // Counters
    this.totalCount++
    if (toBN(wallet.tokensReleased).gt(0)) {
      this.totalCountReleased++
    }

    // Contract data
    if (contract) {
      // Used
      const usedAmount = await contract.usedAmount()
      if (usedAmount.gt(0)) {
        this.totalUsed = this.totalUsed.add(usedAmount)
        this.contractsInProtocol.push({ address: contract.address, tokenAmount: usedAmount })
      }
    }
  }

  private showContracts(contracts: ContractTokenData[]) {
    for (const contractTokenData of contracts) {
      console.log(`  ${contractTokenData.address}: ${formatGRT(contractTokenData.tokenAmount)}`)
    }
  }

  public show(detail = false) {
    console.log(`Managed: ${formatGRT(this.totalManaged)} n:${this.totalCount}`)
    console.log(
      `- Available (${this.totalAvailable.mul(100).div(this.totalManaged)}%):`,
      formatGRT(this.totalAvailable),
    )
    console.log(
      `-- Released (${this.totalReleased.mul(100).div(this.totalAvailable)}%): ${formatGRT(this.totalReleased)} n:${
        this.totalCountReleased
      }`,
    )
    if (detail) {
      this.showContracts(this.contractsReleased)
    }
    if (this.totalUsed.gt(0)) {
      console.log(`- Used ${formatGRT(this.totalUsed)} n:${this.contractsInProtocol.length}`)
      if (detail) {
        this.showContracts(this.contractsInProtocol)
      }
    }
  }
}

// -- Tasks --

task('contracts:list', 'List all token lock contracts').setAction(async () => {
  const allWallets = (await getAllItems(getWallets)) as DeployedTokenLockWallet[]

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
    'tokensReleased',
    'tokensWithdrawn',
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
      toInt(wallet.tokensReleased),
      toInt(wallet.tokensWithdrawn),
    ].join(',')
    console.log(csv)
  }
})

task('contracts:summary', 'Show summary of balances').setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
  // Fetch contracts
  const allWallets = (await getAllItems(getWallets)) as DeployedTokenLockWallet[]

  // Calculate summaries
  const summary: TokenSummary = new TokenSummary()
  const revocableSummary: TokenSummary = new TokenSummary()
  for (const wallet of allWallets) {
    await summary.addWallet(wallet)
    if (wallet.revocable === 'Enabled') {
      await revocableSummary.addWallet(wallet, await hre.ethers.getContractAt('GraphTokenLockWallet', wallet.id))
    }
  }

  // General summary
  console.log('# General Summary')
  summary.show()

  // Summary of revocable contracts
  console.log('\n# Revocable Summary')
  revocableSummary.show(true)
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
    ]).then((results) => results.map((e) => formatGRT(e)))

    const [startTime, endTime, periods, currentPeriod, periodDuration, revocable] = await Promise.all([
      contract.startTime(),
      contract.endTime(),
      contract.periods(),
      contract.currentPeriod(),
      contract.periodDuration(),
      contract.revocable(),
    ])
    const nextTime = startTime.add(currentPeriod.mul(periodDuration))

    console.log(`# Contract at ${contractAddress}`)
    console.log('\n## Schedule')
    console.log(`  ${prettyDate(startTime)} -> ${prettyDate(endTime)} <@${periods} periods>`)
    console.log(`  Next: ${prettyDate(nextTime)} >> ${amountPerPeriod}`)
    console.log(`  Revocable: ${revocable}`)
    console.log('  (=) Managed:', managedAmount)
    console.log('   - Available: ', availableAmount)
    console.log('   - Unvested: ', formatGRT(parseGRT(managedAmount).sub(parseGRT(vestedAmount))))
    console.log('   - Releaseable: ', releasableAmount)
    console.log('\n## Position')
    console.log('  (*) Managed:', managedAmount)
    console.log('  (=) Balance:', currentBalance)
    console.log('  (<) Released: ', releasedAmount)
    console.log('  (>) Used: ', usedAmount)
    console.log('  (+) Surplus: ', surplusAmount)
  })
