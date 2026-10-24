// NASA POWER satellite cross-check (free, no API key): https://power.larc.nasa.gov
// Daily all-sky surface irradiance (GHI, kWh/m²/day) at the project's lat/lon -> physically expected PV output.
const fs = require("fs"); const path = require("path");
const CACHE = path.join(__dirname, "../data/nasa");
const PR_TYPICAL = 0.78, PR_MAX = 0.85; // performance ratio: typical / best-in-class PV system

function cacheFile(lat, lon, start, end) { return path.join(CACHE, `power_${lat}_${lon}_${start}_${end}.json`); }

/** Fetch daily GHI from NASA POWER (cached on disk so demos & tests are reproducible offline). */
async function fetchIrradiance(lat, lon, start, end) {
  const f = cacheFile(lat, lon, start, end);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&start=${start}&end=${end}&format=JSON`;
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`NASA POWER HTTP ${r.status}`);
  const j = await r.json(); const raw = j.properties.parameter.ALLSKY_SFC_SW_DWN;
  const out = { source: "NASA POWER daily API v2 (ALLSKY_SFC_SW_DWN)", url, lat, lon, fetchedAt: new Date().toISOString(),
    daily: Object.fromEntries(Object.entries(raw).filter(([, v]) => v > -900).map(([k, v]) => [`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`, v])) };
  fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(f, JSON.stringify(out, null, 1)); return out;
}

const pearson = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return num / (Math.sqrt(da * db) || 1e-9); };

/** Pure function: compare meter readings with satellite irradiance. Returns risk points + findings. */
function crossCheck(dataset, irr) {
  const findings = []; let risk = 0;
  const pairs = (dataset.readings || []).filter(r => irr.daily[r.t] !== undefined).map(r => ({ t: r.t, kwh: Number(r.value), ghi: irr.daily[r.t] }));
  if (pairs.length < 7) return { risk: 15, findings: [{ severity: "medium", msg: `Satellite cross-check: only ${pairs.length} days overlap NASA data` }], days: pairs };
  const cap = dataset.capacityKw;
  const days = pairs.map(p => ({ ...p, expected: +(cap * p.ghi * PR_TYPICAL).toFixed(1), max: +(cap * p.ghi * PR_MAX).toFixed(1) }));
  const reported = days.reduce((s, d) => s + d.kwh, 0), expected = days.reduce((s, d) => s + d.expected, 0), maxPossible = days.reduce((s, d) => s + d.max, 0);
  const ratio = reported / maxPossible;
  const impossible = days.filter(d => d.kwh > cap * d.ghi * 1.0); // >100% of incoming sunlight energy at STC: physically impossible
  const r = pearson(days.map(d => d.kwh), days.map(d => d.ghi));
  if (ratio > 1.1) { risk += Math.min(30, Math.round((ratio - 1) * 60)); findings.push({ severity: "high", msg: `Satellite: reported ${reported.toFixed(0)} kWh is ${(ratio * 100).toFixed(0)}% of the max NASA irradiance allows (${maxPossible.toFixed(0)} kWh)` }); }
  if (impossible.length) { risk += Math.min(25, 5 + impossible.length * 3); const d = impossible[0]; findings.push({ severity: "high", msg: `Satellite: ${impossible.length} day(s) report more energy than the sun delivered, e.g. ${d.t}: ${d.kwh} kWh vs ${(cap * d.ghi).toFixed(0)} kWh incoming (GHI ${d.ghi})` }); }
  if (r < 0.5) { risk += 15; findings.push({ severity: "high", msg: `Satellite: output does not track sunlight (correlation r=${r.toFixed(2)}); cloudy days show no dip` }); }
  if (!findings.length) findings.push({ severity: "ok", msg: `Satellite: output tracks NASA irradiance (r=${r.toFixed(2)}), ${(reported / expected * 100).toFixed(0)}% of expected` });
  return { risk, findings, correlation: +r.toFixed(3), reportedKwh: +reported.toFixed(1), expectedKwh: +expected.toFixed(1), maxKwh: +maxPossible.toFixed(1), days };
}

module.exports = { fetchIrradiance, crossCheck, pearson, PR_TYPICAL, PR_MAX };
