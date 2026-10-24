// TESTNET ONLY. Usage: npx hardhat run scripts/deploy.js --network sepolia   (or amoy)
// Key comes from TESTNET_PRIVATE_KEY or the throwaway wallet file .secrets/testnet_wallet.json (gitignored).
const hre = require("hardhat"); const fs = require("fs"); const path = require("path");
(async () => {
  const net = await hre.ethers.provider.getNetwork(); const chainId = Number(net.chainId);
  if ([1, 137, 56, 10, 42161, 8453].includes(chainId)) throw new Error("Mainnet refused: testnet only");
  const [signer] = await hre.ethers.getSigners(); if (!signer) throw new Error("No key: set TESTNET_PRIVATE_KEY or create .secrets/testnet_wallet.json");
  const bal = await hre.ethers.provider.getBalance(signer.address);
  console.log("Deployer", signer.address, "balance", hre.ethers.formatEther(bal), "on", hre.network.name);
  if (bal === 0n) throw new Error("Deployer has 0 balance: fund it from a faucet first");
  const out = { network: hre.network.name, chainId, deployer: signer.address, at: new Date().toISOString() };
  for (const name of ["CarbonGuardRegistry", "CBAMAttestation"]) {
    const c = await (await hre.ethers.getContractFactory(name)).deploy(); await c.waitForDeployment();
    out[name] = await c.getAddress(); console.log(name, out[name]);
  }
  const ex = { 11155111: "https://sepolia.etherscan.io/address/", 80002: "https://amoy.polygonscan.com/address/" }[chainId];
  if (ex) { out.explorer = { registry: ex + out.CarbonGuardRegistry, cbam: ex + out.CBAMAttestation }; console.log(out.explorer); }
  fs.mkdirSync(path.join(__dirname, "../deployments"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "../deployments/testnet.json"), JSON.stringify(out, null, 1));
})().catch(e => { console.error(e.message); process.exit(1); });
