import consola from 'consola'
import inquirer from 'inquirer'
import { utils } from 'ethers'

import '@nomiclabs/hardhat-ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

import { GraphTokenMock } from '../build/typechain/contracts/GraphTokenMock'
import { GraphTokenLockManager } from '../build/typechain/contracts/GraphTokenLockManager'

const { getAddress, parseEther, formatEther } = utils

const logger = consola.create({})

export const defaultOverrides: any = {
  gasPrice: utils.parseUnits('25', 'gwei'), // auto
  gasLimit: 2000000, // auto
}

const askConfirm = async (message: string) => {
  const res = await inquirer.prompt({
    name: 'confirm',
    type: 'confirm',
    message,
  })
  return res.confirm
}

const getTokenAddress = async (): Promise<string> => {
  const res1 = await inquirer.prompt({
    name: 'token',
    type: 'input',
    message: 'What is the GRT token address?',
  })

  try {
    return getAddress(res1.token)
  } catch (err) {
    logger.error(err)
    process.exit(1)
  }
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deploy } = hre.deployments
  const { deployer } = await hre.getNamedAccounts()

  logger.info('Deploying TokenLockManager...')

  // -- Graph Token --

  // Get the token address we will use
  const tokenAddress = await getTokenAddress()
  if (!tokenAddress) {
    logger.warn('No token address provided')
    process.exit(1)
  }

  // -- Token Lock Manager --

  // Deploy the master copy of GraphTokenLockWallet
  const masterCopyDeploy = await deploy('GraphTokenLockWallet', {
    from: deployer,
    log: true,
  })

  // Deploy the Manager that uses the master copy to clone contracts
  const managerDeploy = await deploy('GraphTokenLockManager', {
    from: deployer,
    args: [tokenAddress, masterCopyDeploy.address],
    log: true,
  })

  // -- Fund --

  if (await askConfirm('Do you want to fund the manager?')) {
    const fundAmount = parseEther('100000000')
    logger.info(`Funding ${managerDeploy.address} with ${formatEther(fundAmount)} GRT...`)

    // Approve
    const grt = (await hre.ethers.getContractAt('GraphTokenMock', tokenAddress)) as GraphTokenMock
    await grt.approve(managerDeploy.address, fundAmount, defaultOverrides)

    // Deposit
    const manager = (await hre.ethers.getContractAt(
      'GraphTokenLockManager',
      managerDeploy.address,
    )) as GraphTokenLockManager
    await manager.deposit(fundAmount, defaultOverrides)

    logger.success('Done!')
  }
}

func.tags = ['manager']

export default func
