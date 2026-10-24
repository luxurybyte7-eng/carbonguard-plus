// Run: npx hardhat run scripts/server.js   (in-process local chain).  Optional: --network sepolia (needs funded TESTNET_PRIVATE_KEY)
const hre = require("hardhat"); const { ethers } = hre;
const express = require("express"); const path = require("path"); const fs = require("fs"); const crypto = require("crypto");
const { verify, newSalt } = require("../ai/verifier"); const { fetchIrradiance } = require("../ai/satellite"); const cbam = require("../ai/cbam");
// Oracle blinding key: secret, kept off-chain and out of git (.secrets/). Never sent to the browser.
const KEYF = path.join(__dirname, "../.secrets/oracle_blinding_key");
if (!fs.existsSync(KEYF)) { fs.mkdirSync(path.dirname(KEYF), { recursive: true, mode: 0o700 }); fs.writeFileSync(KEYF, crypto.randomBytes(32).toString("hex"), { mode: 0o600 }); }
const BLIND = process.env.ORACLE_BLINDING_KEY || fs.readFileSync(KEYF, "utf8").trim();
const META = ["projectId", "name", "registry", "serial", "vintage", "note"];
const strip = d => Object.fromEntries(Object.entries(d).filter(([k]) => !META.includes(k)));
const range = d => { const t = (d.readings || []).map(r => r.t).sort(); return t.length ? [t[0].replace(/-/g, ""), t[t.length - 1].replace(/-/g, "")] : null; };
async function satelliteFor(d) {
  if (!d.location || d.projectType !== "solar") return null; const r = range(d); if (!r) return null;
  try { return await fetchIrradiance(d.location.lat, d.location.lon, r[0], r[1]); } catch (e) { console.warn("NASA POWER unavailable:", e.message); return null; }
}
(async () => {
  const [admin, buyer] = await ethers.getSigners();
  const reg = await (await ethers.getContractFactory("CarbonGuardRegistry")).deploy(); await reg.waitForDeployment();
  const cb = await (await ethers.getContractFactory("CBAMAttestation")).deploy(); await cb.waitForDeployment();
  const addr = await reg.getAddress(), cbAddr = await cb.getAddress(); console.log("Registry", addr, "CBAM", cbAddr, "on", hre.network.name);
  const app = express(); app.use(express.json({ limit: "2mb" })); app.use(express.static(path.join(__dirname, "../public")));
  app.use("/data", express.static(path.join(__dirname, "../data")));
  const errMsg = (e, c = reg) => { for (const k of [c, reg, cb]) { try { const p = k.interface.parseError(e.data || e.info?.error?.data); if (p) return `${p.name}(${p.args.join(",")})`; } catch {} } return e.shortMessage || e.message; };
  const testnet = JSON.parse(fs.existsSync(path.join(__dirname, "../deployments/testnet.json")) ? fs.readFileSync(path.join(__dirname, "../deployments/testnet.json")) : "null");
  app.get("/api/info", (_, res) => res.json({ network: hre.network.name, registry: addr, cbam: cbAddr, admin: admin.address, testnet }));
  const run = async d => { const m = strip(d); const irr = await satelliteFor(m); return verify(m, { irradiance: irr, salt: BLIND }); };
  app.post("/api/verify", async (req, res) => res.json(await run(req.body)));
  app.post("/api/submit", async (req, res) => {
    const d = req.body; const ai = await run(d); const log = [];
    try {
      let tx = await reg.attest(ai.mrvHash, ai.riskScore, `cg://report/${ai.mrvHash.slice(2, 12)}`); await tx.wait(); log.push(`attest(blindedHash, risk=${ai.riskScore}) tx ${tx.hash}`);
      tx = await reg.issue(ethers.id(d.projectId), d.registry, d.serial, d.vintage, Math.round(d.claimedTonnes), ai.mrvHash); const rc = await tx.wait();
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
  // ---- CBAM module ----
  app.post("/api/cbam/assess", (req, res) => res.json(cbam.assess(req.body)));
  app.post("/api/cbam/attest", async (req, res) => {
    const d = req.body; const ai = cbam.assess(d); const salt = newSalt(); const commitment = cbam.commitment(d, salt); const log = [];
    try {
      const tx = await cb.attest(commitment, ethers.id(d.exporterId), d.cnCode, d.year, d.quarter, Math.round(d.productionTonnes), Math.round(ai.computedIntensity * 1000), ai.riskScore);
      const rc = await tx.wait(); const ev = rc.logs.map(l => { try { return cb.interface.parseLog(l); } catch { return null; } }).find(x => x?.name === "Attested");
      log.push(`CBAM attest(commitment, intensity=${ai.computedIntensity} t/t, risk=${ai.riskScore}) tx ${tx.hash}`);
      res.json({ ok: true, ai, id: ev.args.id, commitment, salt, log });
    } catch (e) { log.push("REVERTED: " + errMsg(e, cb)); res.json({ ok: false, ai, error: errMsg(e, cb), log }); }
  });
  app.post("/api/cbam/verify", async (req, res) => {
    const { id, data, salt } = req.body;
    try {
      const a = await cb.get(id); const out = { found: true, revoked: a.revoked, cnCode: a.cnCode, year: Number(a.year), quarter: Number(a.quarter), tonnes: Number(a.tonnesProduct),
        intensity: Number(a.embeddedKgCO2PerT) / 1000, riskScore: Number(a.riskScore), verifier: a.verifier, timestamp: Number(a.timestamp), commitment: a.commitment, contract: cbAddr };
      if (data && salt) { const c = cbam.commitment(data, salt); out.recomputed = c; out.dataMatches = await cb.verify(id, c); }
      res.json(out);
    } catch (e) { res.json({ found: false, error: errMsg(e, cb) }); }
  });
  const port = process.env.PORT || 8787; app.listen(port, "0.0.0.0", () => console.log(`CarbonGuard demo on http://localhost:${port}`));
})();
