import { constants, Signer } from 'ethers'
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
import { Staking__factory } from '@graphprotocol/contracts/dist/types/factories/Staking__factory'

import { defaultInitArgs, Revocability, TokenLockParameters } from './config'
import { getAccounts, getContract, toGRT, Account, toBN } from './network'
import { defaultAbiCoder, hexValue, keccak256, parseEther } from 'ethers/lib/utils'

const { AddressZero } = constants

async function impersonateAccount(address: string): Promise<Signer> {
  await ethers.provider.send('hardhat_impersonateAccount', [address])
  return ethers.getSigner(address)
}

// Fixture
const setupTest = deployments.createFixture(async ({ deployments }) => {
  const { deploy } = deployments
  const [deployer, , , , l2LockImplementationMock] = await getAccounts()

  // Start from a fresh snapshot
  await deployments.fixture([])

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
  await tokenLockManager.setAuthFunctionCall('withdrawETH(address,uint256)', migratorAddress)
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
  let l2Owner: Account

  let grt: GraphTokenMock
  let tokenLock: GraphTokenLockWallet
  let tokenLockManager: GraphTokenLockManager
  let staking: StakingMock
  let gateway: L1TokenGatewayMock
  let migrator: L1GraphTokenLockMigrator
  let lockAsMigrator: L1GraphTokenLockMigrator

  let initArgs: TokenLockParameters

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
    ;[deployer, beneficiary, hacker, l2ManagerMock, l2LockImplementationMock, l2Owner] = await getAccounts()
  })

  beforeEach(async () => {
    ;({ grt, tokenLockManager, staking, gateway, migrator } = await setupTest())

    // Setup authorized functions in Manager
    await authProtocolFunctions(tokenLockManager, staking.address, migrator.address)

    initArgs = defaultInitArgs(deployer, beneficiary, grt, toGRT('35000000'))
    tokenLock = await initWithArgs(initArgs)

    // Use the tokenLock contract as if it were the L1GraphTokenLockMigrator contract
    lockAsMigrator = L1GraphTokenLockMigrator__factory.connect(tokenLock.address, deployer.signer)

    // Add the migrator and staking contracts as token destinations
    await tokenLockManager.addTokenDestination(migrator.address)
    await tokenLockManager.addTokenDestination(staking.address)

    // Approve contracts to pull tokens from the token lock
    await tokenLock.connect(beneficiary.signer).approveProtocol()
    await migrator.setL2LockManager(tokenLockManager.address, l2ManagerMock.address)
    await migrator.setL2WalletOwner(deployer.address, l2Owner.address)
  })

  describe('Registering L2 managers', function () {
    it('rejects calls from non-owners', async function () {
      const tx = migrator.connect(beneficiary.signer).setL2LockManager(beneficiary.address, hacker.address)
      await expect(tx).revertedWith('Ownable: caller is not the owner')
    })
    it('sets the L2 manager for an L1 manager', async function () {
      await migrator.setL2LockManager(tokenLockManager.address, l2ManagerMock.address)
      expect(await migrator.l2LockManager(tokenLockManager.address)).to.eq(l2ManagerMock.address)
    })
  })
  describe('Registering L2 wallet owners', function () {
    it('rejects calls from non-owners', async function () {
      const tx = migrator.connect(beneficiary.signer).setL2WalletOwner(beneficiary.address, hacker.address)
      await expect(tx).revertedWith('Ownable: caller is not the owner')
    })
    it('sets the L2 wallet owner for an L1 wallet owner', async function () {
      await migrator.setL2WalletOwner(hacker.address, l2Owner.address)
      expect(await migrator.l2WalletOwner(hacker.address)).to.eq(l2Owner.address)
    })
  })
  describe('Depositing, withdrawing and pulling ETH', function () {
    it('allows someone to deposit eth into their token lock account', async function () {
      const tx = migrator.connect(beneficiary.signer).depositETH(tokenLock.address, { value: ticketValue })
      await expect(tx).emit(migrator, 'ETHDeposited').withArgs(tokenLock.address, ticketValue)
      expect(await ethers.provider.getBalance(migrator.address)).to.eq(ticketValue)
      expect(await migrator.tokenLockETHBalances(tokenLock.address)).to.eq(ticketValue)
    })
    it('adds to the token lock ETH balance when called a second time', async function () {
      await migrator.connect(beneficiary.signer).depositETH(tokenLock.address, { value: ticketValue })
      expect(await migrator.tokenLockETHBalances(tokenLock.address)).to.eq(ticketValue)
      await migrator.connect(beneficiary.signer).depositETH(tokenLock.address, { value: ticketValue })
      expect(await migrator.tokenLockETHBalances(tokenLock.address)).to.eq(ticketValue.mul(2))
    })
    it('allows someone to withdraw eth from their token lock account', async function () {
      // We'll withdraw to the "hacker" account so that we don't need to subtract gas
      await migrator.connect(beneficiary.signer).depositETH(tokenLock.address, { value: ticketValue })
      const prevBalance = await ethers.provider.getBalance(hacker.address)
      const tx = lockAsMigrator.connect(beneficiary.signer).withdrawETH(hacker.address, ticketValue)
      await expect(tx).emit(migrator, 'ETHWithdrawn').withArgs(tokenLock.address, hacker.address, ticketValue)
      expect(await ethers.provider.getBalance(migrator.address)).to.eq(0)
      expect(await migrator.tokenLockETHBalances(tokenLock.address)).to.eq(0)
      expect(await ethers.provider.getBalance(hacker.address)).to.eq(prevBalance.add(ticketValue))
    })
    it('allows the Staking contract to pull ETH from the token lock account', async function () {
      await migrator.connect(beneficiary.signer).depositETH(tokenLock.address, { value: ticketValue })
      const prevBalance = parseEther('1')
      await ethers.provider.send('hardhat_setBalance', [staking.address, hexValue(prevBalance)])
      const stakingSigner = await impersonateAccount(staking.address)
      const tx = migrator.connect(stakingSigner).pullETH(tokenLock.address, ticketValue)
      const receipt = await (await tx).wait()
      await expect(tx).emit(migrator, 'ETHPulled').withArgs(tokenLock.address, ticketValue)
      expect(await ethers.provider.getBalance(migrator.address)).to.eq(0)
      expect(await migrator.tokenLockETHBalances(tokenLock.address)).to.eq(0)
      expect(await ethers.provider.getBalance(staking.address)).to.eq(
        prevBalance.add(ticketValue).sub(receipt.gasUsed.mul(receipt.effectiveGasPrice)),
      )
    })
    it('does not allow someone else to pull ETH from the token lock account', async function () {
      await migrator.connect(beneficiary.signer).depositETH(tokenLock.address, { value: ticketValue })
      const tx = migrator.connect(hacker.signer).pullETH(tokenLock.address, ticketValue)
      await expect(tx).revertedWith('ONLY_STAKING')
    })
  })
  describe('Depositing to L2', function () {
    it('rejects calls if the manager is not registered', async function () {
      await migrator.setL2LockManager(tokenLockManager.address, AddressZero)
      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('10000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('INVALID_MANAGER')
    })
    it('rejects calls if the L2 owner for the wallet is not set', async function () {
      const amountToSend = toGRT('1000')
      // "hacker" will be the owner here, and it does not have an L2 owner set
      initArgs = defaultInitArgs(hacker, beneficiary, grt, toGRT('2000000'))
      tokenLock = await initWithArgs(initArgs)
      lockAsMigrator = L1GraphTokenLockMigrator__factory.connect(tokenLock.address, deployer.signer)
      await tokenLock.connect(beneficiary.signer).acceptLock()

      // Good hacker pays for the gas
      await migrator.connect(hacker.signer).depositETH(tokenLock.address, { value: ticketValue })
      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(amountToSend, maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('L2_OWNER_NOT_SET')
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
    it('rejects calls if the wallet does not have a sufficient ETH balance previously deposited', async function () {
      await tokenLock.connect(beneficiary.signer).acceptLock()

      const tx = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('35000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx).revertedWith('INSUFFICIENT_ETH_BALANCE')

      // Try again but with an ETH balance that is insufficient by 1 wei
      await migrator.connect(hacker.signer).depositETH(tokenLock.address, { value: ticketValue.sub(1) })
      const tx2 = lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(toGRT('35000000'), maxGas, gasPrice, maxSubmissionCost)
      await expect(tx2).revertedWith('INSUFFICIENT_ETH_BALANCE')
    })
    it('sends tokens and a callhook to the L2 manager registered for the wallet', async function () {
      await tokenLock.connect(beneficiary.signer).acceptLock()
      const amountToSend = toGRT('1000')

      const expectedWalletData = defaultAbiCoder.encode(
        ['tuple(address,address,address,uint256,uint256,uint256)'],
        [
          [
            tokenLock.address,
            l2Owner.address,
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

      const expectedOutboundCalldata = await gateway.getOutboundCalldata(
        grt.address,
        migrator.address,
        l2ManagerMock.address,
        amountToSend,
        expectedWalletData,
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
      // Check the events emitted from the mock gateway
      await expect(tx)
        .emit(gateway, 'FakeTxToL2')
        .withArgs(migrator.address, ticketValue, maxGas, gasPrice, maxSubmissionCost, expectedOutboundCalldata)
      // and check that the right amount of funds have been pulled from the token lock
      expect(await grt.balanceOf(tokenLock.address)).to.equal(initArgs.managedAmount.sub(amountToSend))
    })
    it('uses the previous L2 wallet address if called for a second time', async function () {
      await tokenLock.connect(beneficiary.signer).acceptLock()
      const amountToSend = toGRT('1000')

      const expectedWalletData = defaultAbiCoder.encode(
        ['tuple(address,address,address,uint256,uint256,uint256)'],
        [
          [
            tokenLock.address,
            l2Owner.address,
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

      const expectedOutboundCalldata = await gateway.getOutboundCalldata(
        grt.address,
        migrator.address,
        l2ManagerMock.address,
        amountToSend,
        expectedWalletData,
      )

      // Good hacker pays for the gas
      await migrator.connect(hacker.signer).depositETH(tokenLock.address, { value: ticketValue.mul(2) })
      await lockAsMigrator
        .connect(beneficiary.signer)
        .depositToL2Locked(amountToSend, maxGas, gasPrice, maxSubmissionCost)
      // Call again
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
      // Check the events emitted from the mock gateway
      await expect(tx)
        .emit(gateway, 'FakeTxToL2')
        .withArgs(migrator.address, ticketValue, maxGas, gasPrice, maxSubmissionCost, expectedOutboundCalldata)
      // and check that the right amount of funds have been pulled from the token lock
      expect(await grt.balanceOf(tokenLock.address)).to.equal(initArgs.managedAmount.sub(amountToSend.mul(2)))
    })
    it('accepts calls from a wallet that has funds staked in the protocol', async function () {
      // Use the tokenLock contract as if it were the Staking contract
      const lockAsStaking = Staking__factory.connect(tokenLock.address, deployer.signer)
      const stakeAmount = toGRT('1000')
      // Stake some funds
      await lockAsStaking.connect(beneficiary.signer).stake(stakeAmount)

      await tokenLock.connect(beneficiary.signer).acceptLock()
      const amountToSend = toGRT('1000')

      const expectedWalletData = defaultAbiCoder.encode(
        ['tuple(address,address,address,uint256,uint256,uint256)'],
        [
          [
            tokenLock.address,
            l2Owner.address,
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

      const expectedOutboundCalldata = await gateway.getOutboundCalldata(
        grt.address,
        migrator.address,
        l2ManagerMock.address,
        amountToSend,
        expectedWalletData,
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
      // Check the events emitted from the mock gateway
      await expect(tx)
        .emit(gateway, 'FakeTxToL2')
        .withArgs(migrator.address, ticketValue, maxGas, gasPrice, maxSubmissionCost, expectedOutboundCalldata)
      // and check that the right amount of funds have been pulled from the token lock
      expect(await grt.balanceOf(tokenLock.address)).to.equal(initArgs.managedAmount.sub(amountToSend).sub(stakeAmount))
    })
  })
})
