// Run: npx hardhat run scripts/server.js   (in-process local chain).  Optional: --network sepolia (needs funded TESTNET_PRIVATE_KEY)
const hre = require("hardhat"); const { ethers } = hre;
const express = require("express"); const path = require("path"); const fs = require("fs"); const crypto = require("crypto");
const { verify, newSalt } = require("../ai/verifier"); const { summarize } = require("../ai/llm"); const { fetchIrradiance } = require("../ai/satellite"); const cbam = require("../ai/cbam");
// Oracle blinding key: secret, kept off-chain and out of git (.secrets/). Never sent to the browser.
const KEYF = path.join(__dirname, "../.secrets/oracle_blinding_key");
if (!fs.existsSync(KEYF)) { fs.mkdirSync(path.dirname(KEYF), { recursive: true, mode: 0o700 }); fs.writeFileSync(KEYF, crypto.randomBytes(32).toString("hex"), { mode: 0o600 }); }
const BLIND = process.env.ORACLE_BLINDING_KEY || fs.readFileSync(KEYF, "utf8").trim();
const META = ["projectId", "name", "registry", "serial", "vintage", "note"];
const strip = d => Object.fromEntries(Object.entries(d).filter(([k]) => !META.includes(k)));
const range = d => { const t = (d.readings || []).map(r => r.t).sort(); return t.length ? [t[0].replace(/-/g, ""), t[t.length - 1].replace(/-/g, "")] : null; };
async function satelliteFor(d) {
  if (!d.location || d.projectType !== "solar") return null; const r = range(d); if (!r) return null;
  const lat = Number(d.location.lat), lon = Number(d.location.lon); // validated numbers only (no path traversal into the cache filename)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !r.every(x => /^\d{8}$/.test(x))) return null;
  d = { ...d, location: { lat: +lat.toFixed(2), lon: +lon.toFixed(2) } };
  try { return await fetchIrradiance(d.location.lat, d.location.lon, r[0], r[1]); } catch (e) { console.warn("NASA POWER unavailable:", e.message); return null; }
}
(async () => {
  // Separate keys per role (OpenClaw finding #1): admin = governance only, oracle = AI verifier, issuer = project developer.
  const [admin, oracle, issuer] = await ethers.getSigners();
  const reg0 = await (await ethers.getContractFactory("CarbonGuardRegistry")).deploy(oracle.address, issuer.address); await reg0.waitForDeployment();
  const cb0 = await (await ethers.getContractFactory("CBAMAttestation")).deploy(oracle.address); await cb0.waitForDeployment();
  const reg = reg0, regO = reg0.connect(oracle), regI = reg0.connect(issuer), cb = cb0.connect(oracle);
  const addr = await reg.getAddress(), cbAddr = await cb.getAddress(); console.log("Registry", addr, "CBAM", cbAddr, "on", hre.network.name);
  const app = express(); app.set("trust proxy", 1); app.use(express.json({ limit: "200kb" }));
  // Public-demo protection: per-IP rate limit on all API calls, optional API key / read-only mode for writes.
  const hits = new Map(), LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 30);
  app.use("/api", (req, res, next) => { const k = req.ip, now = Date.now(); const h = (hits.get(k) || []).filter(t => now - t < 60000); h.push(now); hits.set(k, h);
    if (h.length > LIMIT) return res.status(429).json({ ok: false, error: "Rate limit: max " + LIMIT + " requests/min in the public demo" }); next(); });
  const write = (req, res, next) => { if (process.env.READ_ONLY === "1") return res.status(403).json({ ok: false, error: "Read-only demo mode" });
    if (process.env.API_KEY && req.get("x-api-key") !== process.env.API_KEY) return res.status(401).json({ ok: false, error: "API key required" }); next(); }; app.use(express.static(path.join(__dirname, "../public")));
  app.use("/data", express.static(path.join(__dirname, "../data")));
  const errMsg = (e, c = reg) => { for (const k of [c, reg, cb]) { try { const p = k.interface.parseError(e.data || e.info?.error?.data); if (p) return `${p.name}(${p.args.join(",")})`; } catch {} } return e.shortMessage || e.message; };
  const testnet = JSON.parse(fs.existsSync(path.join(__dirname, "../deployments/testnet.json")) ? fs.readFileSync(path.join(__dirname, "../deployments/testnet.json")) : "null");
  app.get("/api/info", (_, res) => res.json({ network: hre.network.name, registry: addr, cbam: cbAddr, admin: admin.address, oracle: oracle.address, issuer: issuer.address, mode: process.env.READ_ONLY === "1" ? "read-only" : process.env.API_KEY ? "api-key" : "public-rate-limited", rateLimitPerMin: LIMIT, testnet }));
  const run = async d => { const m = strip(d); const irr = await satelliteFor(m); return verify(m, { irradiance: irr, salt: BLIND }); };
  app.post("/api/verify", async (req, res) => { try { res.json(await run(req.body)); } catch (e) { res.status(400).json({ error: "Bad dataset: " + e.message }); } });
  app.post("/api/summary", async (req, res) => { try { res.json(await summarize(await run(req.body))); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post("/api/submit", write, async (req, res) => {
    const d = req.body; const ai = await run(d); const log = [];
    try {
      const pid = ethers.id(String(d.projectId)), amt = Math.round(d.claimedTonnes), vin = Number(d.vintage);
      let tx = await regO.attest(ai.mrvHash, pid, amt, vin, ai.riskScore, `cg://report/${ai.mrvHash.slice(2, 12)}`); await tx.wait(); log.push(`[oracle ${oracle.address.slice(0, 8)}] attest(blindedHash, project, amount=${amt}, vintage=${vin}, risk=${ai.riskScore}) tx ${tx.hash}`);
      tx = await regI.issue(pid, String(d.registry), String(d.serial), vin, amt, ai.mrvHash); const rc = await tx.wait();
      const ev = rc.logs.map(l => { try { return reg.interface.parseLog(l); } catch { return null; } }).find(x => x?.name === "Issued");
      log.push(`[issuer ${issuer.address.slice(0, 8)}] issue() tx ${tx.hash}`); res.json({ ok: true, ai, batchId: ev.args.batchId, log });
    } catch (e) { log.push("REVERTED: " + errMsg(e)); res.json({ ok: false, ai, error: errMsg(e), log }); }
  });
  app.post("/api/retire", write, async (req, res) => {
    try { const { batchId, amount, beneficiary } = req.body; const tx = await regI.retire(batchId, amount, beneficiary, "Offset claim"); await tx.wait(); res.json({ ok: true, tx: tx.hash }); }
    catch (e) { res.json({ ok: false, error: errMsg(e) }); }
  });
  app.get("/api/batches", async (_, res) => {
    const n = Number(await reg.batchCount()); const out = [];
    for (let i = 0; i < n; i++) { const id = await reg.batchIds(i); const b = await reg.batches(id); out.push({ id, vintage: Number(b.vintage), amount: Number(b.amount), retired: Number(b.retired), riskScore: Number(b.riskScore), mrvHash: b.mrvHash, owner: b.owner, balance: Number(await reg.balanceOf(id, issuer.address)) }); }
    res.json(out);
  });
  // ---- CBAM module ----
  app.post("/api/cbam/assess", (req, res) => res.json(cbam.assess(req.body)));
  app.post("/api/cbam/attest", write, async (req, res) => {
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
