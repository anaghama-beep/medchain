require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    // The local chain starts 150 days in the past so seeded demo records get a realistic
    // history; the seed script then fast-forwards the chain clock to the present.
    hardhat: { initialDate: new Date(Date.now() - 150 * 24 * 3600 * 1000).toISOString() },
    localhost: { url: "http://127.0.0.1:8545" },
    ...(process.env.SEPOLIA_RPC_URL && process.env.DEPLOYER_KEY
      ? { sepolia: { url: process.env.SEPOLIA_RPC_URL, accounts: [process.env.DEPLOYER_KEY] } }
      : {}),
  },
};
