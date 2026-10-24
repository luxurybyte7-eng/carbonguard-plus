// TESTNET ONLY: npx hardhat run scripts/deploy.js --network amoy   (needs TESTNET_PRIVATE_KEY of a fresh faucet-funded wallet)
const hre = require("hardhat");
(async () => { if ([1, 137, 56].includes(Number((await hre.ethers.provider.getNetwork()).chainId))) throw new Error("Mainnet refused: testnet only");
  const c = await (await hre.ethers.getContractFactory("CarbonGuardRegistry")).deploy(); await c.waitForDeployment(); console.log("CarbonGuardRegistry:", await c.getAddress()); })();
