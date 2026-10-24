// CarbonGuard AI verifier: scores MRV (measurement, reporting, verification) data for fraud / over-claiming risk.
// Pure JS, explainable, no external API needed. Outputs a 0-100 risk score + human-readable findings.
const crypto = require("crypto");

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))) || 1e-9; };
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

// Robust anomaly detection with modified z-score (MAD) - resistant to the outliers it is looking for.
function anomalies(values, thresh = 3.5) {
  const med = median(values);
  const mad = median(values.map(v => Math.abs(v - med))) || 1e-9;
  return values.map((v, i) => ({ i, v, z: 0.6745 * (v - med) / mad })).filter(o => Math.abs(o.z) > thresh);
}

/**
 * dataset = { projectType: "solar"|"reforestation"|"cookstove", claimedTonnes, readings:[{t, value}],
 *             gridEmissionFactor (tCO2/MWh, solar), capacityKw (solar), areaHa (reforestation) }
 */
function verify(dataset, opts = {}) {
  const findings = [];
  let risk = 0;
  const vals = (dataset.readings || []).map(r => Number(r.value));
  const irr = opts.irradiance; // NASA POWER data (optional): enables weather-normalised checks
  let satellite = null;
  if (vals.length < 7) { findings.push({ severity: "high", msg: `Only ${vals.length} readings - insufficient monitoring data` }); risk += 35; }

  // 1. Sensor anomalies (spikes / tampering)
  // With satellite data, look for anomalies in output-per-sunlight (so cloudy days are not false positives).
  const series = irr && dataset.capacityKw ? (dataset.readings || []).map(r => irr.daily[r.t] ? Number(r.value) / irr.daily[r.t] : null).filter(x => x !== null) : vals;
  const an = series.length ? anomalies(series) : [];
  if (an.length) {
    const pct = an.length / vals.length;
    risk += Math.min(30, Math.round(pct * 150) + 5);
    findings.push({ severity: pct > 0.1 ? "high" : "medium", msg: `${an.length} anomalous reading(s) (robust z > 3.5${irr ? ", weather-normalised" : ""}), e.g. day #${an[0].i + 1}` });
  }
  // 2. Flat-line / copy-paste data detection
  const uniq = new Set(vals.map(v => v.toFixed(3))).size;
  if (vals.length >= 7 && uniq / vals.length < 0.3) { risk += 20; findings.push({ severity: "high", msg: `Readings look duplicated/flat-lined (${uniq} unique of ${vals.length})` }); }

  // 3. Physical plausibility + claim consistency
  let expected = null;
  if (dataset.projectType === "solar") {
    const mwh = vals.reduce((s, x) => s + x, 0) / 1000; // readings in kWh
    expected = mwh * (dataset.gridEmissionFactor ?? 0.71); // India CEA grid factor ~0.71 tCO2/MWh
    if (dataset.capacityKw) {
      const maxDaily = dataset.capacityKw * 24 * 0.35; // >35% capacity factor/day is implausible for PV
      const bad = vals.filter(v => v > maxDaily).length;
      if (bad) { risk += 25; findings.push({ severity: "high", msg: `${bad} day(s) exceed physical PV max (${maxDaily.toFixed(0)} kWh/day for ${dataset.capacityKw} kW)` }); }
    }
  } else if (dataset.projectType === "reforestation") {
    expected = (dataset.areaHa || 0) * 10; // ~10 tCO2/ha/yr upper typical sequestration
  } else if (dataset.projectType === "cookstove") {
    expected = vals.reduce((s, x) => s + x, 0) * 0.0015; // kg wood saved*factor (illustrative)
  }
  if (expected !== null) {
    const ratio = dataset.claimedTonnes / Math.max(expected, 1e-9);
    if (ratio > 1.1) { const add = Math.min(40, Math.round((ratio - 1) * 40)); risk += add; findings.push({ severity: ratio > 1.5 ? "high" : "medium", msg: `Claim ${dataset.claimedTonnes} t is ${(ratio * 100).toFixed(0)}% of data-supported ${expected.toFixed(1)} t (over-claiming)` }); }
    else findings.push({ severity: "ok", msg: `Claim ${dataset.claimedTonnes} t is consistent with data-supported ${expected.toFixed(1)} t` });
  }
  // 4. Independent satellite cross-check (NASA POWER irradiance)
  if (irr && dataset.projectType === "solar" && dataset.capacityKw) {
    satellite = require("./satellite").crossCheck(dataset, irr);
    risk += satellite.risk; findings.push(...satellite.findings);
  } else if (dataset.projectType === "solar") findings.push({ severity: "medium", msg: "Satellite cross-check not run (no location / NASA data)" });
  risk = Math.max(0, Math.min(100, risk));
  if (!findings.some(f => f.severity !== "ok")) findings.push({ severity: "ok", msg: "No anomalies detected" });
  return { riskScore: risk, expectedTonnes: expected === null ? null : +expected.toFixed(2), decision: risk <= 40 ? "PASS" : "BLOCK", findings, mrvHash: mrvHash(dataset, opts.salt),
    satellite: satellite && { correlation: satellite.correlation, reportedKwh: satellite.reportedKwh, expectedKwh: satellite.expectedKwh, maxKwh: satellite.maxKwh, days: satellite.days, source: irr.source } };
}

// Canonical hash of the dataset (sorted keys) => same data can never be issued twice on-chain.
// Privacy ("zk-ready" blinded fingerprint): if the oracle's secret 32-byte blinding key is given, the on-chain
// value is HMAC-SHA256(key, canonical(data)). It is still deterministic (so re-used data is still caught as a
// duplicate) but outsiders cannot brute-force-guess meter data from the chain. Raw data stays off-chain.
// This is a keyed hash commitment, NOT a zero-knowledge proof.
function canonical(o) { if (Array.isArray(o)) return `[${o.map(canonical).join(",")}]`; if (o && typeof o === "object") return `{${Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + canonical(o[k])).join(",")}}`; return JSON.stringify(o); }
function mrvHash(d, salt) { const { claimedTonnes, note, ...data } = d; const h = salt ? crypto.createHmac("sha256", Buffer.from(salt.replace(/^0x/, ""), "hex")) : crypto.createHash("sha256"); return "0x" + h.update(canonical(data)).digest("hex"); }
const newSalt = () => "0x" + crypto.randomBytes(32).toString("hex");

module.exports = { verify, anomalies, mrvHash, canonical, newSalt };
