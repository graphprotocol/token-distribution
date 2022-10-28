import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { askConfirm, waitTransaction } from './create'
import consola from 'consola'

const logger = consola.create({})

task('beneficiary-accept-lock', 'Accept token lock. Only callable by beneficiary')
  .addParam('contract', 'Address of the vesting contract')
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const { deployer } = await hre.getNamedAccounts()

    const vestingContract = await hre.ethers.getContractAt('GraphTokenLockWallet', taskArgs.contract)
    const beneficiary = await vestingContract.beneficiary()
    let isAccepted = await vestingContract.isAccepted()

    logger.info(`Vesting contract address: ${vestingContract.address}}`)
    logger.info(`Beneficiary: ${beneficiary}`)
    logger.info(`Connected account: ${deployer}`)
    logger.info(`Lock accepted: ${isAccepted}`)

    // Check lock status
    if (isAccepted) {
      logger.warn('Lock already accepted, exiting...')
      process.exit(0)
    }

    // Check beneficiary
    if (beneficiary !== deployer) {
      logger.error('Only the beneficiary can accept the vesting contract lock!')
      process.exit(1)
    }

    // Confirm
    logger.info('Preparing transaction to accept token lock...')
    if (!(await askConfirm())) {
      logger.log('Cancelled')
      process.exit(1)
    }

    // Accept lock
    const tx = await vestingContract.acceptLock()
    await waitTransaction(tx)

    // Verify lock state
    isAccepted = await vestingContract.isAccepted()
    if (isAccepted) {
      logger.info(`Lock accepted successfully!`)
    } else {
      logger.error(`Lock not accepted! Unknown error, please try again`)
    }
  })
