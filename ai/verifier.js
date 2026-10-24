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
function verify(dataset) {
  const findings = [];
  let risk = 0;
  const vals = (dataset.readings || []).map(r => Number(r.value));
  if (vals.length < 7) { findings.push({ severity: "high", msg: `Only ${vals.length} readings - insufficient monitoring data` }); risk += 35; }

  // 1. Sensor anomalies (spikes / tampering)
  const an = vals.length ? anomalies(vals) : [];
  if (an.length) {
    const pct = an.length / vals.length;
    risk += Math.min(30, Math.round(pct * 150) + 5);
    findings.push({ severity: pct > 0.1 ? "high" : "medium", msg: `${an.length} anomalous reading(s) (robust z > 3.5), e.g. index ${an[0].i} value ${an[0].v}` });
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
  risk = Math.max(0, Math.min(100, risk));
  if (!findings.some(f => f.severity !== "ok")) findings.push({ severity: "ok", msg: "No anomalies detected" });
  return { riskScore: risk, expectedTonnes: expected === null ? null : +expected.toFixed(2), decision: risk <= 40 ? "PASS" : "BLOCK", findings, mrvHash: mrvHash(dataset) };
}

// Canonical hash of the dataset (sorted keys) => same data can never be issued twice on-chain.
function canonical(o) { if (Array.isArray(o)) return `[${o.map(canonical).join(",")}]`; if (o && typeof o === "object") return `{${Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + canonical(o[k])).join(",")}}`; return JSON.stringify(o); }
function mrvHash(d) { const { claimedTonnes, ...data } = d; return "0x" + crypto.createHash("sha256").update(canonical(data)).digest("hex"); }

module.exports = { verify, anomalies, mrvHash, canonical };
