require("@nomicfoundation/hardhat-toolbox");
const accounts = process.env.TESTNET_PRIVATE_KEY ? [process.env.TESTNET_PRIVATE_KEY] : [];
module.exports = {
  solidity: "0.8.24",
  networks: {
    // TESTNETS ONLY. Never put a mainnet key here.
    sepolia: { url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org", accounts, chainId: 11155111 },
    amoy: { url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology", accounts, chainId: 80002 },
  },
};
