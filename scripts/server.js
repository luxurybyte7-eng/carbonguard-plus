// Run: npx hardhat run scripts/server.js   (in-process local chain)  — or --network amoy for testnet
const hre = require("hardhat"); const { ethers } = hre;
const express = require("express"); const path = require("path");
const { verify } = require("../ai/verifier");
(async () => {
  const [admin, buyer] = await ethers.getSigners();
  const reg = await (await ethers.getContractFactory("CarbonGuardRegistry")).deploy(); await reg.waitForDeployment();
  const addr = await reg.getAddress(); console.log("Registry deployed at", addr, "on", hre.network.name);
  const app = express(); app.use(express.json({ limit: "2mb" })); app.use(express.static(path.join(__dirname, "../public")));
  app.use("/data", express.static(path.join(__dirname, "../data")));
  const errMsg = e => { try { const p = reg.interface.parseError(e.data || e.info?.error?.data); if (p) return `${p.name}(${p.args.join(",")})`; } catch {} return e.shortMessage || e.message; };
  app.get("/api/info", (_, res) => res.json({ network: hre.network.name, registry: addr, admin: admin.address, buyer: buyer?.address }));
  app.post("/api/verify", (req, res) => { const { projectId, name, registry, serial, vintage, ...m } = req.body; res.json(verify(m)); });
  app.post("/api/submit", async (req, res) => {
    const d = req.body; const { projectId, name, registry, serial, vintage, ...m } = d; const ai = verify(m); const log = [];
    try {
      let tx = await reg.attest(ai.mrvHash, ai.riskScore, `cg://report/${ai.mrvHash.slice(2, 12)}`); await tx.wait(); log.push(`attest(risk=${ai.riskScore}) tx ${tx.hash}`);
      tx = await reg.issue(ethers.id(projectId), registry, serial, vintage, Math.round(d.claimedTonnes), ai.mrvHash); const rc = await tx.wait();
      const ev = rc.logs.map(l => { try { return reg.interface.parseLog(l); } catch { return null; } }).find(x => x?.name === "Issued");
      log.push(`issue() tx ${tx.hash}`); res.json({ ok: true, ai, batchId: ev.args.batchId, log });
    } catch (e) { log.push("REVERTED: " + errMsg(e)); res.json({ ok: false, ai, error: errMsg(e), log }); }
  });
  app.post("/api/retire", async (req, res) => {
    try { const { batchId, amount, beneficiary } = req.body; const tx = await reg.retire(batchId, amount, beneficiary, "Offset claim"); await tx.wait(); res.json({ ok: true, tx: tx.hash }); }
    catch (e) { res.json({ ok: false, error: errMsg(e) }); }
  });
  app.get("/api/batches", async (_, res) => {
    const n = Number(await reg.batchCount()); const out = [];
    for (let i = 0; i < n; i++) { const id = await reg.batchIds(i); const b = await reg.batches(id); out.push({ id, vintage: Number(b.vintage), amount: Number(b.amount), retired: Number(b.retired), riskScore: Number(b.riskScore), mrvHash: b.mrvHash, owner: b.owner, balance: Number(await reg.balanceOf(id, admin.address)) }); }
    res.json(out);
  });
  const port = process.env.PORT || 8787; app.listen(port, "0.0.0.0", () => console.log(`CarbonGuard demo on http://localhost:${port}`));
})();
