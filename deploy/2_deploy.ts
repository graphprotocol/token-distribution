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

const getDeploymentName = async (defaultName: string): Promise<string> => {
  const res = await inquirer.prompt({
    name: 'deployment-name',
    type: 'input',
    default: defaultName,
    message: 'Save deployment as?',
  })
  return res['deployment-name']
}

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deploy } = hre.deployments
  const { deployer } = await hre.getNamedAccounts()

  // -- Graph Token --

  // Get the token address we will use
  const tokenAddress = await getTokenAddress()
  if (!tokenAddress) {
    logger.warn('No token address provided')
    process.exit(1)
  }

  // -- Token Lock Manager --

  // Deploy the master copy of GraphTokenLockWallet
  logger.info('Deploying GraphTokenLockWallet master copy...')
  const masterCopySaveName = await getDeploymentName('GraphTokenLockWallet')
  const masterCopyDeploy = await deploy(masterCopySaveName, {
    from: deployer,
    log: true,
    contract: 'GraphTokenLockWallet',
  })

  // Deploy the Manager that uses the master copy to clone contracts
  logger.info('Deploying GraphTokenLockManager...')
  const managerSaveName = await getDeploymentName('GraphTokenLockManager')
  const managerDeploy = await deploy(managerSaveName, {
    from: deployer,
    args: [tokenAddress, masterCopyDeploy.address],
    log: true,
    contract: 'GraphTokenLockManager',
  })

  // -- Fund --

  if (await askConfirm('Do you want to fund the manager?')) {
    const fundAmount = parseEther('100000000')
    logger.info(`Funding ${managerDeploy.address} with ${formatEther(fundAmount)} GRT...`)

    // Approve
    const grt = (await hre.ethers.getContractAt('GraphTokenMock', tokenAddress)) as GraphTokenMock
    await grt.approve(managerDeploy.address, fundAmount)

    // Deposit
    const manager = (await hre.ethers.getContractAt(
      'GraphTokenLockManager',
      managerDeploy.address,
    )) as GraphTokenLockManager
    await manager.deposit(fundAmount)

    logger.success('Done!')
  }
}

func.tags = ['manager']

export default func
