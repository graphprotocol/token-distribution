import { constants, BigNumber, Wallet } from 'ethers'
import { expect } from 'chai'
import { deployments, ethers } from 'hardhat'

import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'

import { GraphTokenMock } from '../build/typechain/contracts/GraphTokenMock'
import { GraphTokenLockWallet } from '../build/typechain/contracts/GraphTokenLockWallet'
import { GraphTokenLockManager } from '../build/typechain/contracts/GraphTokenLockManager'
import { StakingMock } from '../build/typechain/contracts/StakingMock'
import { L1TokenGatewayMock } from '../build/typechain/contracts/L1TokenGatewayMock'
import { L1GraphTokenLockMigrator } from '../build/typechain/contracts/L1GraphTokenLockMigrator'

import { L1GraphTokenLockMigrator__factory } from '../build/typechain/contracts/factories/L1GraphTokenLockMigrator__factory'

import { defaultInitArgs, Revocability, TokenLockParameters } from './config'
import {
  advanceTimeAndBlock,
  getAccounts,
  getContract,
  toGRT,
  Account,
  randomHexBytes,
  advanceBlocks,
  toBN,
} from './network'
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils'

const { AddressZero, MaxUint256 } = constants

// -- Time utils --

const advancePeriods = async (tokenLock: GraphTokenLockWallet, n = 1) => {
  const periodDuration = await tokenLock.periodDuration()
  return advanceTimeAndBlock(periodDuration.mul(n).toNumber()) // advance N period
}
const advanceToStart = async (tokenLock: GraphTokenLockWallet) => moveToTime(tokenLock, await tokenLock.startTime(), 60)
const moveToTime = async (tokenLock: GraphTokenLockWallet, target: BigNumber, buffer: number) => {
  const ts = await tokenLock.currentTime()
  const delta = target.sub(ts).add(buffer)
  return advanceTimeAndBlock(delta.toNumber())
}

// Fixture
const setupTest = deployments.createFixture(async ({ deployments }) => {
  const { deploy } = deployments
  const [deployer, beneficiary, hacker, l2ManagerMock, l2LockImplementationMock] = await getAccounts()

  // Deploy token
  await deploy('GraphTokenMock', {
    from: deployer.address,
    args: [toGRT('1000000000'), deployer.address],
  })
  const grt = await getContract('GraphTokenMock')

  // Deploy token lock masterCopy
  await deploy('GraphTokenLockWallet', {
    from: deployer.address,
  })
  const tokenLockWallet = await getContract('GraphTokenLockWallet')

  // Deploy token lock manager
  await deploy('GraphTokenLockManager', {
    from: deployer.address,
    args: [grt.address, tokenLockWallet.address],
  })
  const tokenLockManager = await getContract('GraphTokenLockManager')

  // Protocol contracts
  await deploy('StakingMock', { from: deployer.address, args: [grt.address] })
  const staking = await getContract('StakingMock')

  await deploy('L1TokenGatewayMock', { from: deployer.address, args: [] })
  const gateway = await getContract('L1TokenGatewayMock')

  // Deploy migrator

  await deploy('L1GraphTokenLockMigrator', {
    from: deployer.address,
    args: [grt.address, l2LockImplementationMock.address, gateway.address, staking.address],
  })
  const migrator = await getContract('L1GraphTokenLockMigrator')

  // Fund the manager contract
  await grt.connect(deployer.signer).transfer(tokenLockManager.address, toGRT('100000000'))

  return {
    grt: grt as GraphTokenMock,
    staking: staking as StakingMock,
    // tokenLock: tokenLockWallet as GraphTokenLockWallet,
    tokenLockManager: tokenLockManager as GraphTokenLockManager,
    gateway: gateway as L1TokenGatewayMock,
    migrator: migrator as L1GraphTokenLockMigrator,
  }
})

async function authProtocolFunctions(
  tokenLockManager: GraphTokenLockManager,
  stakingAddress: string,
  migratorAddress: string,
) {
  await tokenLockManager.setAuthFunctionCall('stake(uint256)', stakingAddress)
  await tokenLockManager.setAuthFunctionCall('unstake(uint256)', stakingAddress)
  await tokenLockManager.setAuthFunctionCall('withdraw()', stakingAddress)
  await tokenLockManager.setAuthFunctionCall('depositToL2Locked(uint256,uint256,uint256,uint256)', migratorAddress)
}

// -- Tests --

const maxSubmissionCost = toBN('10000')
const maxGas = toBN('1000000')
const gasPrice = toBN('10')
const ticketValue = maxSubmissionCost.add(maxGas.mul(gasPrice))

describe('L1GraphTokenLockMigrator', () => {
  let deployer: Account
  let beneficiary: Account
  let hacker: Account
  let l2ManagerMock: Account
  let l2LockImplementationMock: Account

  let grt: GraphTokenMock
  let tokenLock: GraphTokenLockWallet
  let tokenLockManager: GraphTokenLockManager
  let staking: StakingMock
  let gateway: L1TokenGatewayMock
  let migrator: L1GraphTokenLockMigrator

  let initArgs: TokenLockParameters

  async function getState(tokenLock) {
    const beneficiaryAddress = await tokenLock.beneficiary()
    const ownerAddress = await tokenLock.owner()
    return {
      beneficiaryBalance: await grt.balanceOf(beneficiaryAddress),
      contractBalance: await grt.balanceOf(tokenLock.address),
      ownerBalance: await grt.balanceOf(ownerAddress),
      releasableAmount: await tokenLock.releasableAmount(),
      releasedAmount: await tokenLock.releasedAmount(),
      revokedAmount: await tokenLock.revokedAmount(),
      surplusAmount: await tokenLock.surplusAmount(),
      managedAmount: await tokenLock.managedAmount(),
      usedAmount: await tokenLock.usedAmount(),
    }
  }

  const initWithArgs = async (args: TokenLockParameters): Promise<GraphTokenLockWallet> => {
    const tx = await tokenLockManager.createTokenLockWallet(
      args.owner,
      args.beneficiary,
      args.managedAmount,
      args.startTime,
      args.endTime,
      args.periods,
      args.releaseStartTime,
      args.vestingCliffTime,
      args.revocable,
    )
    const receipt = await tx.wait()
    const contractAddress = receipt.events[0].args['proxy']
    return ethers.getContractAt('GraphTokenLockWallet', contractAddress) as Promise<GraphTokenLockWallet>
  }

  before(async function () {
    ;[deployer, beneficiary, hacker, l2ManagerMock, l2LockImplementationMock] = await getAccounts()
  })

  beforeEach(async () => {
    ;({ grt, tokenLockManager, staking, gateway, migrator } = await setupTest())

    // Setup authorized functions in Manager
    await authProtocolFunctions(tokenLockManager, staking.address, migrator.address)

    initArgs = defaultInitArgs(deployer, beneficiary, grt, toGRT('35000000'))
    tokenLock = await initWithArgs(initArgs)
  })

  describe('Registering L2 managers', function () {
    it('rejects calls from non-owners', async function () {
      const tx = migrator.connect(beneficiary.signer).setL2LockManager(beneficiary.address, hacker.address)
      await expect(tx).revertedWith('Ownable: caller is not the owner')
    })
    it('sets the L2 manager for an L1 manager', async function () {
      await migrator.setL2LockManager(tokenLockManager.address, l2ManagerMock.address)
      expect(await migrator.l2LockManager(tokenLockManager.address)).to.equal(l2ManagerMock.address)
    })
  })
  describe('Depositing, withdrawing and pulling ETH', function () {
    it('allows someone to deposit eth into their token lock account')
    it('allows someone to withdraw eth from their token lock account')
    it('allows the Staking contract to pull ETH from the token lock account')
    it('does not allow someone else to pull ETH from the token lock account')
  })
  describe('Depositing to L2', function () {
    let lockAsMigrator: L1GraphTokenLockMigrator

    beforeEach(async () => {
      // Use the tokenLock contract as if it were the L1GraphTokenLockMigrator contract
      lockAsMigrator = L1GraphTokenLockMigrator__factory.connect(tokenLock.address, deployer.signer)

      // Add the migrator contract as token destination
      await tokenLockManager.addTokenDestination(migrator.address)

      // Approve contracts to pull tokens from the token lock
      await tokenLock.connect(beneficiary.signer).approveProtocol()
      await migrator.setL2LockManager(tokenLockManager.address, l2ManagerMock.address)
    })

    it('rejects calls if the manager is not registered', async function () {
      await migrator.setL2LockManager(tokenLockManager.address, AddressZero)
      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('10000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('INVALID_MANAGER')
    })

    it('rejects calls from wallets that have the wrong token address', async function () {
      // WalletMock constructor args are: target, token, manager, isInitialized, isAccepted
      await deployments.deploy('WalletMock', {
        from: deployer.address,
        args: [migrator.address, '0x5c946740441C12510a167B447B7dE565C20b9E3C', tokenLockManager.address, true, true],
      })
      const wrongTokenWallet = await getContract('WalletMock')
      const walletAsMigrator = L1GraphTokenLockMigrator__factory.connect(wrongTokenWallet.address, deployer.signer)

      const tx = walletAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('10000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('INVALID_TOKEN')
    })

    it('rejects calls from a wallet that has not accepted the lock', async function () {
      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('10000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('!ACCEPTED')
    })
    it('rejects calls from a wallets that is not initialized', async function () {
      // WalletMock constructor args are: target, token, manager, isInitialized, isAccepted
      await deployments.deploy('WalletMock', {
        from: deployer.address,
        args: [migrator.address, grt.address, tokenLockManager.address, false, true],
      })
      const uninitWallet = await getContract('WalletMock')
      const walletAsMigrator = L1GraphTokenLockMigrator__factory.connect(uninitWallet.address, deployer.signer)

      const tx = walletAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('10000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('!INITIALIZED')
    })
    it('rejects calls from a revocable wallet', async function () {
      initArgs.revocable = Revocability.Enabled
      tokenLock = await initWithArgs(initArgs)

      await tokenLock.connect(beneficiary.signer).acceptLock()
      lockAsMigrator = L1GraphTokenLockMigrator__factory.connect(tokenLock.address, deployer.signer)
      await tokenLock.connect(beneficiary.signer).approveProtocol()
      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('10000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('REVOCABLE')
    })
    it('rejects calls if the wallet does not have enough tokens', async function () {
      await tokenLock.connect(beneficiary.signer).acceptLock()

      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('35000001'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('INSUFFICIENT_BALANCE')
    })
    it('rejects calls if the amount is zero', async function () {
      await tokenLock.connect(beneficiary.signer).acceptLock()

      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('0'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('ZERO_AMOUNT')
    })
    it('sends tokens and a callhook to the L2 manager registered for the wallet', async function () {
      await tokenLock.connect(beneficiary.signer).acceptLock()
      const amountToSend = toGRT('1000')

      const expectedWalletData = defaultAbiCoder.encode(
        ['tuple(address,address,address,uint256,uint256,uint256)'],
        [
          [
            tokenLock.address,
            initArgs.owner,
            initArgs.beneficiary,
            initArgs.managedAmount,
            initArgs.startTime,
            initArgs.endTime,
          ],
        ],
      )
      const expectedL2Address = await migrator.getDeploymentAddress(
        keccak256(expectedWalletData),
        l2LockImplementationMock.address,
        l2ManagerMock.address,
      )

      // Good hacker pays for the gas
      await migrator.connect(hacker.signer).depositETH(tokenLock.address, { value: ticketValue })
      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(amountToSend, maxGas, gasPrice, maxSubmissionCost)
      await expect(tx)
        .emit(migrator, 'LockedFundsSentToL2')
        .withArgs(
          lockAsMigrator.address,
          expectedL2Address,
          tokenLockManager.address,
          l2ManagerMock.address,
          amountToSend,
        )
      // TODO: check the events emitted from the mock gateway,
      // and check that the right amount of funds have been pulled from the token lock
    })
    it('uses the previous L2 wallet address if called for a second time')
    it('accepts calls from a wallet that has funds staked in the protocol')
  })
})
