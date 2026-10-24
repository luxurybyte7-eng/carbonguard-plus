require("@nomicfoundation/hardhat-toolbox");
const fs = require("fs");
const wf = __dirname + "/.secrets/testnet_wallet.json"; // throwaway testnet wallet, gitignored
const key = process.env.TESTNET_PRIVATE_KEY || (fs.existsSync(wf) ? JSON.parse(fs.readFileSync(wf, "utf8")).privateKey : null);
const accounts = key ? [key] : [];
module.exports = {
  solidity: "0.8.24",
  networks: {
    // TESTNETS ONLY. Never put a mainnet key here.
    sepolia: { url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", accounts, chainId: 11155111 },
    amoy: { url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology", accounts, chainId: 80002 },
  },
};
