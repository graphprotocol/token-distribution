import { extendEnvironment, task } from 'hardhat/config'

// Plugins

import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-etherscan'
import '@nomiclabs/hardhat-waffle'
import 'hardhat-deploy'
import 'hardhat-abi-exporter'
import 'hardhat-typechain'

// Tasks

import './ops/create'

// Networks

interface NetworkConfig {
  network: string
  chainId: number
  url?: string
  gas?: number | 'auto'
  gasPrice?: number | 'auto'
}

const networkConfigs: NetworkConfig[] = [
  { network: 'mainnet', chainId: 1 },
  { network: 'ropsten', chainId: 3 },
  { network: 'rinkeby', chainId: 4 },
  { network: 'kovan', chainId: 42 },
]

function getAccountMnemonic() {
  return process.env.MNEMONIC || ''
}

function getDefaultProviderURL(network: string) {
  return `https://${network}.infura.io/v3/${process.env.INFURA_KEY}`
}

function setupNetworkConfig(config) {
  for (const netConfig of networkConfigs) {
    config.networks[netConfig.network] = {
      chainId: netConfig.chainId,
      url: netConfig.url ? netConfig.url : getDefaultProviderURL(netConfig.network),
      gas: netConfig.gas || 'auto',
      gasPrice: netConfig.gasPrice || 'auto',
      accounts: {
        mnemonic: getAccountMnemonic(),
      },
    }
  }
}

// Env

extendEnvironment(async (hre) => {
  const accounts = await hre.ethers.getSigners()
  try {
    const deployment = await hre.deployments.get('GraphTokenLockManager')
    const contract = await hre.ethers.getContractAt('GraphTokenLockManager', deployment.address)
    await contract.deployed() // test if deployed

    hre['c'] = {
      GraphTokenLockManager: contract.connect(accounts[0]),
    }
  } catch (err) {
    // do not load the contract
  }
})

// Tasks

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners()
  for (const account of accounts) {
    console.log(await account.getAddress())
  }
})

// Config

const config = {
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './build/artifacts',
  },
  solidity: {
    version: '0.7.3',
    optimizer: {
      enabled: true,
      runs: 200,
    },
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      chainId: 1337,
      loggingEnabled: false,
      gas: 12000000,
      gasPrice: 'auto',
      blockGasLimit: 12000000,
    },
    ganache: {
      chainId: 1337,
      url: 'http://localhost:8545',
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  etherscan: {
    url: process.env.ETHERSCAN_API_URL,
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  typechain: {
    outDir: 'build/typechain/contracts',
    target: 'ethers-v5',
  },
  abiExporter: {
    path: './build/abis',
    clear: false,
    flat: true,
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: false,
  },
}

setupNetworkConfig(config)

export default config
