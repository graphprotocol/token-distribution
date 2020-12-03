import { constants } from 'ethers'
import { expect } from 'chai'
import { deployments, ethers } from 'hardhat'

import '@nomiclabs/hardhat-ethers'
import 'hardhat-deploy'

import { GraphTokenMock } from '../build/typechain/contracts/GraphTokenMock'
import { GraphTokenLockWallet } from '../build/typechain/contracts/GraphTokenLockWallet'
import { GraphTokenLockManager } from '../build/typechain/contracts/GraphTokenLockManager'
import { StakingMock } from '../build/typechain/contracts/StakingMock'

import { StakingFactory } from '@graphprotocol/contracts/dist/typechain/contracts/StakingFactory'

import { defaultInitArgs, TokenLockParameters } from './config'
import { getAccounts, getContract, toGRT, Account, randomHexBytes } from './network'

const { AddressZero, MaxUint256 } = constants

// Fixture
const setupTest = deployments.createFixture(async ({ deployments }) => {
  const { deploy } = deployments
  const [deployer] = await getAccounts()

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
  await deployments.deploy('StakingMock', { from: deployer.address, args: [grt.address] })
  const staking = await getContract('StakingMock')

  // Fund the manager contract
  await grt.connect(deployer.signer).transfer(tokenLockManager.address, toGRT('35000000'))

  return {
    grt: grt as GraphTokenMock,
    staking: staking as StakingMock,
    // tokenLock: tokenLockWallet as GraphTokenLockWallet,
    tokenLockManager: tokenLockManager as GraphTokenLockManager,
  }
})

async function authProtocolFunctions(tokenLockManager: GraphTokenLockManager, stakingAddress: string) {
  await tokenLockManager.setAuthFunctionCall('stake(uint256)', stakingAddress)
}

// -- Tests --

describe('GraphTokenLockWallet', () => {
  let deployer: Account
  let beneficiary: Account
  let hacker: Account

  let grt: GraphTokenMock
  let tokenLock: GraphTokenLockWallet
  let tokenLockManager: GraphTokenLockManager
  let staking: StakingMock

  let initArgs: TokenLockParameters

  const initWithArgs = async (args: TokenLockParameters): Promise<GraphTokenLockWallet> => {
    const tx = await tokenLockManager.createTokenLockWallet(
      args.owner,
      args.beneficiary,
      args.managedAmount,
      args.startTime,
      args.endTime,
      args.periods,
      0,
      args.revocable,
    )
    const receipt = await tx.wait()
    const contractAddress = receipt.events[0].args['proxy']
    return ethers.getContractAt('GraphTokenLockWallet', contractAddress) as Promise<GraphTokenLockWallet>
  }

  before(async function () {
    ;[deployer, beneficiary, hacker] = await getAccounts()
  })

  beforeEach(async () => {
    ;({ grt, tokenLockManager, staking } = await setupTest())

    // Setup authorized functions in Manager
    await authProtocolFunctions(tokenLockManager, staking.address)

    initArgs = defaultInitArgs(deployer, beneficiary, grt, toGRT('35000000'))
    tokenLock = await initWithArgs(initArgs)
  })

  describe('Init', function () {
    it('should bubble up revert reasons on create', async function () {
      initArgs = defaultInitArgs(deployer, beneficiary, grt, toGRT('35000000'))
      const tx = initWithArgs({ ...initArgs, endTime: 0 })
      await expect(tx).revertedWith('Start time > end time')
    })

    // it('reject re-initialization', async function () {
    //   const tx = initWithArgs(initArgs)
    //   await expect(tx).revertedWith('Already initialized')
    // })
  })

  describe('admin', function () {
    it('should set manager', async function () {
      // Note: we use GRT contract here just to provide a different contract
      const oldManager = await tokenLock.manager()
      const tx = tokenLock.connect(deployer.signer).setManager(grt.address)
      await expect(tx).emit(tokenLock, 'ManagerUpdated').withArgs(oldManager, grt.address)
      expect(await tokenLock.manager()).eq(grt.address)
    })

    it('reject set manager to a non-contract', async function () {
      const newAddress = randomHexBytes(20)
      const tx = tokenLock.connect(deployer.signer).setManager(newAddress)
      await expect(tx).revertedWith('Manager must be a contract')
    })

    it('reject set manager to empty address', async function () {
      const tx = tokenLock.connect(deployer.signer).setManager(AddressZero)
      await expect(tx).revertedWith('Manager cannot be empty')
    })
  })

  describe('enabling protocol', function () {
    beforeEach(async function () {
      await tokenLockManager.addTokenDestination(staking.address)
    })

    it('should approve protocol contracts', async function () {
      const tx = tokenLock.connect(beneficiary.signer).approveProtocol()
      await expect(tx).emit(grt, 'Approval').withArgs(tokenLock.address, staking.address, MaxUint256)
    })

    it('should revoke protocol contracts', async function () {
      const tx = tokenLock.connect(beneficiary.signer).revokeProtocol()
      await expect(tx).emit(grt, 'Approval').withArgs(tokenLock.address, staking.address, 0)
    })

    it('reject approve and revoke if not the beneficiary', async function () {
      const tx1 = tokenLock.connect(deployer.signer).approveProtocol()
      await expect(tx1).revertedWith('!auth')

      const tx2 = tokenLock.connect(deployer.signer).revokeProtocol()
      await expect(tx2).revertedWith('!auth')
    })
  })

  describe('function call forwarding', function () {
    let lockAsStaking

    beforeEach(async () => {
      // Use the tokenLock contract as if it were the Staking contract
      lockAsStaking = StakingFactory.connect(tokenLock.address, deployer.signer)

      // Add the staking contract as token destination
      await tokenLockManager.addTokenDestination(staking.address)

      // Approve contracts to pull tokens from the token lock
      await tokenLock.connect(beneficiary.signer).approveProtocol()
    })

    it('should call an authorized function (stake)', async function () {
      // Before state
      const beforeLockBalance = await grt.balanceOf(lockAsStaking.address)

      // Stake must work and the deposit address must be the one of the lock contract
      const stakeAmount = toGRT('100')
      const tx = lockAsStaking.connect(beneficiary.signer).stake(stakeAmount)
      await expect(tx).emit(staking, 'StakeDeposited').withArgs(tokenLock.address, stakeAmount)

      // After state
      const afterLockBalance = await grt.balanceOf(lockAsStaking.address)
      expect(afterLockBalance).eq(beforeLockBalance.sub(stakeAmount))
    })

    it('should bubble up revert reasons for forwarded calls', async function () {
      // Force a failing call
      const tx = lockAsStaking.connect(beneficiary.signer).stake(toGRT('0'))
      await expect(tx).revertedWith('!tokens')
    })

    it('reject a function call from other than the beneficiary', async function () {
      // Send a function call from an unauthorized caller
      const stakeAmount = toGRT('100')
      const tx = lockAsStaking.connect(hacker.signer).stake(stakeAmount)
      await expect(tx).revertedWith('Unauthorized caller')
    })

    it('reject a function call that is not authorized', async function () {
      // Send a function call that is not authorized in the TokenLockManager
      const tx = lockAsStaking.connect(beneficiary.signer).setController(randomHexBytes(20))
      await expect(tx).revertedWith('Unauthorized function')
    })
  })
})
