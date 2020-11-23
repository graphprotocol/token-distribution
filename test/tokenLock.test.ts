import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { deployments, ethers } from 'hardhat'
import 'hardhat-deploy'

import { GraphTokenMock } from '../build/typechain/contracts/GraphTokenMock'
import { GraphTokenLock } from '../build/typechain/contracts/GraphTokenLock'

import { createScheduleScenarios, TokenLockParameters } from './config'
import { advanceTimeAndBlock, getAccounts, getContract, toBN, toGRT, Account } from './network'

const { AddressZero } = ethers.constants

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

  // Deploy token lock
  await deploy('GraphTokenLock', {
    from: deployer.address,
    args: [],
  })
  const tokenLock = await getContract('GraphTokenLock')

  return {
    grt: grt as GraphTokenMock,
    tokenLock: tokenLock as GraphTokenLock,
  }
})

// -- Time utils --

const advancePeriods = async (tokenLock: GraphTokenLock, n = 1) => {
  const periodDuration = await tokenLock.periodDuration()
  return advanceTimeAndBlock(periodDuration.mul(n).toNumber()) // advance one period
}

const advanceToAboutStart = async (tokenLock: GraphTokenLock) => {
  // 60 second buffer to accommodate precision error
  const target = (await tokenLock.startTime()).sub(60)
  const delta = target.sub(await tokenLock.currentTime())
  return advanceTimeAndBlock(delta.toNumber())
}

const advanceToStart = async (tokenLock: GraphTokenLock) => {
  // 60 second buffer to accommodate precision error
  const target = (await tokenLock.startTime()).add(60)
  const delta = target.sub(await tokenLock.currentTime())
  return advanceTimeAndBlock(delta.toNumber())
}

const advanceToEnd = async (tokenLock: GraphTokenLock) => {
  // 60 second buffer to accommodate precision error
  const target = (await tokenLock.endTime()).add(60)
  const delta = target.sub(await tokenLock.currentTime())
  return advanceTimeAndBlock(delta.toNumber())
}

const forEachPeriod = async (tokenLock: GraphTokenLock, fn) => {
  await advanceToStart(tokenLock)

  const periods = (await tokenLock.periods()).toNumber()
  for (let currentPeriod = 1; currentPeriod <= periods + 1; currentPeriod++) {
    const currentPeriod = await tokenLock.currentPeriod()
    // console.log('\t  ✓ period ->', currentPeriod.toString())
    await fn(currentPeriod.sub(1), currentPeriod)
    await advancePeriods(tokenLock, 1)
  }
}

const shouldMatchSchedule = async (tokenLock: GraphTokenLock, fnName: string, initArgs: TokenLockParameters) => {
  await forEachPeriod(tokenLock, async function (passedPeriods: BigNumber) {
    const amount = (await tokenLock.functions[fnName]())[0]
    const amountPerPeriod = await tokenLock.amountPerPeriod()
    const managedAmount = await tokenLock.managedAmount()

    // console.log(`\t    - amount: ${formatGRT(amount)}/${formatGRT(managedAmount)}`)

    // After last period we expect to have all managed tokens available
    const expectedAmount = passedPeriods.lt(initArgs.periods) ? passedPeriods.mul(amountPerPeriod) : managedAmount
    expect(amount).eq(expectedAmount)
  })
}

// -- Tests --

describe('GraphTokenLock', () => {
  let deployer: Account
  let beneficiary1: Account
  let beneficiary2: Account

  let grt: GraphTokenMock
  let tokenLock: GraphTokenLock

  let initArgs: TokenLockParameters

  const initWithArgs = (args: TokenLockParameters) => {
    return tokenLock
      .connect(deployer.signer)
      .initialize(
        args.owner,
        args.beneficiary,
        args.token,
        args.managedAmount,
        args.startTime,
        args.endTime,
        args.periods,
        0,
        args.revocable,
      )
  }

  const fundContract = async (contract: GraphTokenLock) => {
    const managedAmount = await contract.managedAmount()
    await grt.connect(deployer.signer).transfer(contract.address, managedAmount)
  }

  before(async function () {
    ;[deployer, beneficiary1, beneficiary2] = await getAccounts()
  })

  createScheduleScenarios().forEach(async function (schedule) {
    describe('> Test scenario', function () {
      beforeEach(async function () {
        ;({ grt, tokenLock } = await setupTest())

        const staticArgs = {
          owner: deployer.address,
          beneficiary: beneficiary1.address,
          token: grt.address,
          managedAmount: toGRT('35000000'),
        }
        initArgs = { ...staticArgs, ...schedule }
        await initWithArgs(initArgs)

        // Move time to just before the contract starts
        await advanceToAboutStart(tokenLock)
      })

      describe('Init', function () {
        it('reject re-initialization', async function () {
          const tx = initWithArgs(initArgs)
          await expect(tx).revertedWith('Already initialized')
        })

        it('should be each parameter initialized properly', async function () {
          console.log('\t>> Scenario ', JSON.stringify(schedule))

          expect(await tokenLock.beneficiary()).eq(initArgs.beneficiary)
          expect(await tokenLock.managedAmount()).eq(initArgs.managedAmount)
          expect(await tokenLock.startTime()).eq(initArgs.startTime)
          expect(await tokenLock.endTime()).eq(initArgs.endTime)
          expect(await tokenLock.periods()).eq(initArgs.periods)
          expect(await tokenLock.token()).eq(initArgs.token)
          expect(await tokenLock.revocable()).eq(initArgs.revocable)
        })
      })

      describe('Balance', function () {
        describe('currentBalance()', function () {
          it('should match to deposited balance', async function () {
            // Before
            expect(await tokenLock.currentBalance()).eq(0)

            // Transfer
            const totalAmount = toGRT('100')
            await grt.connect(deployer.signer).transfer(tokenLock.address, totalAmount)

            // After
            expect(await tokenLock.currentBalance()).eq(totalAmount)
          })
        })
      })

      describe('Time & periods', function () {
        // describe('currentTime()', function () {
        //   it('should return current block time', async function () {
        //     expect(await tokenLock.currentTime()).eq(await latestBlockTime())
        //   })
        // })

        describe('duration()', function () {
          it('should match init parameters', async function () {
            const duration = initArgs.endTime - initArgs.startTime
            expect(await tokenLock.duration()).eq(toBN(duration))
          })
        })

        describe('sinceStartTime()', function () {
          it('should be zero if currentTime < startTime', async function () {
            const now = +new Date() / 1000
            if (now < initArgs.startTime) {
              expect(await tokenLock.sinceStartTime()).eq(0)
            }
          })

          it('should be right amount of time elapsed', async function () {
            await advanceTimeAndBlock(initArgs.startTime + 60)

            const elapsedTime = (await tokenLock.currentTime()).sub(initArgs.startTime)
            expect(await tokenLock.sinceStartTime()).eq(elapsedTime)
          })
        })

        describe('amountPerPeriod()', function () {
          it('should match init parameters', async function () {
            const amountPerPeriod = initArgs.managedAmount.div(initArgs.periods)
            expect(await tokenLock.amountPerPeriod()).eq(amountPerPeriod)
          })
        })

        describe('periodDuration()', async function () {
          it('should match init parameters', async function () {
            const periodDuration = toBN(initArgs.endTime - initArgs.startTime).div(initArgs.periods)
            expect(await tokenLock.periodDuration()).eq(periodDuration)
          })
        })

        describe('currentPeriod()', function () {
          it('should be one (1) before start time', async function () {
            expect(await tokenLock.currentPeriod()).eq(1)
          })

          it('should return correct amount for each period', async function () {
            await advanceToStart(tokenLock)

            for (let currentPeriod = 1; currentPeriod <= initArgs.periods; currentPeriod++) {
              expect(await tokenLock.currentPeriod()).eq(currentPeriod)
              // console.log('\t  ✓ period ->', currentPeriod)
              await advancePeriods(tokenLock, 1)
            }
          })
        })

        describe('passedPeriods()', function () {
          it('should return correct amount for each period', async function () {
            await advanceToStart(tokenLock)

            for (let currentPeriod = 1; currentPeriod <= initArgs.periods; currentPeriod++) {
              expect(await tokenLock.passedPeriods()).eq(currentPeriod - 1)
              // console.log('\t  ✓ period ->', currentPeriod)
              await advancePeriods(tokenLock, 1)
            }
          })
        })
      })

      describe('Locking & release', function () {
        describe('availableAmount()', function () {
          it('should return zero before start time', async function () {
            expect(await tokenLock.availableAmount()).eq(0)
          })

          it('should return correct amount for each period', async function () {
            await shouldMatchSchedule(tokenLock, 'availableAmount', initArgs)
          })

          it('should return full managed amount after end time', async function () {
            await advanceToEnd(tokenLock)

            const managedAmount = await tokenLock.managedAmount()
            expect(await tokenLock.availableAmount()).eq(managedAmount)
          })
        })

        describe('vestedAmount()', function () {
          it('should be fully vested if non-revocable', async function () {
            const isRevocable = await tokenLock.revocable()
            const vestedAmount = await tokenLock.vestedAmount()
            if (!isRevocable) {
              expect(vestedAmount).eq(await tokenLock.managedAmount())
            }
          })

          it('should match the vesting schedule if revocable', async function () {
            const isRevocable = await tokenLock.revocable()
            if (isRevocable) {
              await shouldMatchSchedule(tokenLock, 'vestedAmount', initArgs)
            }
          })
        })

        describe('releasableAmount()', function () {
          it('should always return zero if there is no balance in the contract', async function () {
            await forEachPeriod(tokenLock, async function () {
              const releasableAmount = await tokenLock.releasableAmount()
              expect(releasableAmount).eq(0)
            })
          })

          context('> when funded', function () {
            beforeEach(async function () {
              await fundContract(tokenLock)
            })

            it('should match the release schedule', async function () {
              await shouldMatchSchedule(tokenLock, 'releasableAmount', initArgs)
            })

            it('should subtract already released amount', async function () {
              await advanceToStart(tokenLock)

              // After one period release
              await advancePeriods(tokenLock, 1)
              const releasableAmountPeriod1 = await tokenLock.releasableAmount()
              await tokenLock.connect(beneficiary1.signer).release()

              // Next periods test that we are not counting released amount on previous period
              await advancePeriods(tokenLock, 2)
              const availableAmount = await tokenLock.availableAmount()
              const releasableAmountPeriod2 = await tokenLock.releasableAmount()
              expect(releasableAmountPeriod2).eq(availableAmount.sub(releasableAmountPeriod1))
            })
          })
        })

        describe('totalOutstandingAmount()', function () {
          it('should be the total managed amount when have not released yet', async function () {
            const managedAmount = await tokenLock.managedAmount()
            const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
            expect(totalOutstandingAmount).eq(managedAmount)
          })

          context('when funded', function () {
            beforeEach(async function () {
              await fundContract(tokenLock)
            })

            it('should be the total managed when have not started', async function () {
              const managedAmount = await tokenLock.managedAmount()
              const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
              expect(totalOutstandingAmount).eq(managedAmount)
            })

            it('should be the total managed less the already released amount', async function () {
              // Setup
              await advanceToStart(tokenLock)
              await advancePeriods(tokenLock, 1)

              // Release
              const amountToRelease = await tokenLock.releasableAmount()
              await tokenLock.connect(beneficiary1.signer).release()

              const managedAmount = await tokenLock.managedAmount()
              const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
              expect(totalOutstandingAmount).eq(managedAmount.sub(amountToRelease))
            })

            it('should be zero when all funds have been released', async function () {
              // Setup
              await advanceToEnd(tokenLock)

              // Release
              await tokenLock.connect(beneficiary1.signer).release()

              // Test
              const totalOutstandingAmount = await tokenLock.totalOutstandingAmount()
              expect(totalOutstandingAmount).eq(0)
            })
          })
        })

        describe('surplusAmount()', function () {
          it('should be zero when balance under outstanding amount', async function () {
            // Setup
            await fundContract(tokenLock)
            await advanceToStart(tokenLock)

            // Test
            const surplusAmount = await tokenLock.surplusAmount()
            expect(surplusAmount).eq(0)
          })

          it('should return any balance over outstanding amount', async function () {
            // Setup
            await fundContract(tokenLock)
            await advanceToStart(tokenLock)
            await advancePeriods(tokenLock, 1)
            await tokenLock.connect(beneficiary1.signer).release()

            // Send extra amount
            await grt.connect(deployer.signer).transfer(tokenLock.address, toGRT('1000'))

            // Test
            const surplusAmount = await tokenLock.surplusAmount()
            expect(surplusAmount).eq(toGRT('1000'))
          })
        })
      })

      describe('Beneficiary admin', function () {
        describe('changeBeneficiary()', function () {
          it('should change beneficiary', async function () {
            const tx = tokenLock.connect(beneficiary1.signer).changeBeneficiary(beneficiary2.address)
            await expect(tx).emit(tokenLock, 'BeneficiaryChanged').withArgs(beneficiary2.address)

            const afterBeneficiary = await tokenLock.beneficiary()
            expect(afterBeneficiary).eq(beneficiary2.address)
          })

          it('reject if beneficiary is zero', async function () {
            const tx = tokenLock.connect(beneficiary1.signer).changeBeneficiary(AddressZero)
            await expect(tx).revertedWith('Empty beneficiary')
          })

          it('reject if not authorized', async function () {
            const tx = tokenLock.connect(deployer.signer).changeBeneficiary(beneficiary2.address)
            await expect(tx).revertedWith('!auth')
          })
        })
      })

      describe('Value transfer', function () {
        async function getState(tokenLock: GraphTokenLock) {
          const beneficiaryAddress = await tokenLock.beneficiary()
          const ownerAddress = await tokenLock.owner()
          return {
            beneficiaryBalance: await grt.balanceOf(beneficiaryAddress),
            contractBalance: await grt.balanceOf(tokenLock.address),
            ownerBalance: await grt.balanceOf(ownerAddress),
          }
        }

        describe('release()', function () {
          it('should release the scheduled amount', async function () {
            // Setup
            await fundContract(tokenLock)
            await advanceToStart(tokenLock)
            await advancePeriods(tokenLock, 1)

            // Before state
            const before = await getState(tokenLock)

            // Release
            const amountToRelease = await tokenLock.releasableAmount()
            const tx = tokenLock.connect(beneficiary1.signer).release()
            await expect(tx).emit(tokenLock, 'TokensReleased').withArgs(beneficiary1.address, amountToRelease)

            // After state
            const after = await getState(tokenLock)
            expect(after.beneficiaryBalance).eq(before.beneficiaryBalance.add(amountToRelease))
            expect(after.contractBalance).eq(before.contractBalance.sub(amountToRelease))
            expect(await tokenLock.releasableAmount()).eq(0)
          })

          it('reject release if no funds available', async function () {
            // Setup
            await fundContract(tokenLock)

            // Release
            const tx = tokenLock.connect(beneficiary1.signer).release()
            await expect(tx).revertedWith('No available releasable amount')
          })

          it('reject release if not the beneficiary', async function () {
            const tx = tokenLock.connect(beneficiary2.signer).release()
            await expect(tx).revertedWith('!auth')
          })
        })

        describe('withdrawSurplus()', function () {
          it('should withdraw surplus balance that is over managed amount', async function () {
            // Setup
            const managedAmount = await tokenLock.managedAmount()
            const amountToWithdraw = toGRT('100')
            const totalAmount = managedAmount.add(amountToWithdraw)
            await grt.connect(deployer.signer).transfer(tokenLock.address, totalAmount)

            // Revert if trying to withdraw more than managed amount
            const tx1 = tokenLock.connect(beneficiary1.signer).withdrawSurplus(amountToWithdraw.add(1))
            await expect(tx1).revertedWith('Amount requested > surplus available')

            // Before state
            const before = await getState(tokenLock)

            // Should withdraw
            const tx2 = tokenLock.connect(beneficiary1.signer).withdrawSurplus(amountToWithdraw)
            await expect(tx2).emit(tokenLock, 'TokensWithdrawn').withArgs(beneficiary1.address, amountToWithdraw)

            // After state
            const after = await getState(tokenLock)
            expect(after.beneficiaryBalance).eq(before.beneficiaryBalance.add(amountToWithdraw))
            expect(after.contractBalance).eq(before.contractBalance.sub(amountToWithdraw))
          })

          it('should withdraw surplus balance that is over managed amount (less than total available)', async function () {
            // Setup
            const managedAmount = await tokenLock.managedAmount()
            const surplusAmount = toGRT('100')
            const totalAmount = managedAmount.add(surplusAmount)
            await grt.connect(deployer.signer).transfer(tokenLock.address, totalAmount)

            // Should withdraw
            const tx2 = tokenLock.connect(beneficiary1.signer).withdrawSurplus(surplusAmount.sub(1))
            await expect(tx2).emit(tokenLock, 'TokensWithdrawn').withArgs(beneficiary1.address, surplusAmount.sub(1))
          })

          it('reject withdraw if not the beneficiary', async function () {
            await grt.connect(deployer.signer).transfer(tokenLock.address, toGRT('100'))

            const tx = tokenLock.connect(beneficiary2.signer).withdrawSurplus(toGRT('100'))
            await expect(tx).revertedWith('!auth')
          })

          it('reject withdraw zero tokens', async function () {
            const tx = tokenLock.connect(beneficiary1.signer).withdrawSurplus(toGRT('0'))
            await expect(tx).revertedWith('Amount cannot be zero')
          })

          it('reject withdraw more than available funds', async function () {
            const tx = tokenLock.connect(beneficiary1.signer).withdrawSurplus(toGRT('100'))
            await expect(tx).revertedWith('Amount requested > surplus available')
          })
        })

        describe('revoke()', function () {
          beforeEach(async function () {
            await fundContract(tokenLock)
            await advanceToStart(tokenLock)
          })

          it('should revoke and get funds back to owner', async function () {
            if (initArgs.revocable) {
              // Before state
              const before = await getState(tokenLock)

              // Revoke
              const beneficiaryAddress = await tokenLock.beneficiary()
              const vestedAmount = await tokenLock.vestedAmount()
              const managedAmount = await tokenLock.managedAmount()
              const unvestedAmount = managedAmount.sub(vestedAmount)
              const tx = tokenLock.connect(deployer.signer).revoke()
              await expect(tx).emit(tokenLock, 'TokensRevoked').withArgs(beneficiaryAddress, unvestedAmount)

              // After state
              const after = await getState(tokenLock)
              expect(after.ownerBalance).eq(before.ownerBalance.add(unvestedAmount))
            }
          })

          it('reject revoke multiple times', async function () {
            if (initArgs.revocable) {
              await tokenLock.connect(deployer.signer).revoke()
              const tx = tokenLock.connect(deployer.signer).revoke()
              await expect(tx).revertedWith('Already revoked')
            }
          })

          it('reject revoke if not authorized', async function () {
            const tx = tokenLock.connect(beneficiary1.signer).revoke()
            await expect(tx).revertedWith('Ownable: caller is not the owner')
          })

          it('reject revoke if not revocable', async function () {
            if (!initArgs.revocable) {
              const tx = tokenLock.connect(deployer.signer).revoke()
              await expect(tx).revertedWith('Contract is non-revocable')
            }
          })

          it('reject revoke if no available unvested amount', async function () {
            if (initArgs.revocable) {
              // Setup
              await advanceToEnd(tokenLock)

              // Try to revoke after all tokens have been vested
              const tx = tokenLock.connect(deployer.signer).revoke()
              await expect(tx).revertedWith('No available unvested amount')
            }
          })
        })
      })
    })
  })
})
