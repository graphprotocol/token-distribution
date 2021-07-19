import axios from 'axios'
import { task } from 'hardhat/config'
import '@nomiclabs/hardhat-ethers'

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

const toInt = (s) => parseInt(s) / 1e18

// -- Tasks --

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
  const url = 'https://api.thegraph.com/subgraphs/name/graphprotocol/token-distribution'
  const res = await axios.post(url, { query })
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

task('contracts:list', 'Create token lock contracts from file').setAction(async () => {
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
