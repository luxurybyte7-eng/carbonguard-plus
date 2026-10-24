// CBAM embedded-emissions checker for Indian steel / aluminium exporters (EU CBAM, definitive period from 2026).
// Recomputes direct + indirect emissions from activity data and flags anomalies vs the declared intensity
// and vs production-route benchmarks. Emission factors / benchmarks are ILLUSTRATIVE defaults for the demo,
// not the official EU default values.
const { canonical } = require("./verifier"); const crypto = require("crypto");
const EF = { cokingCoalT: 2.6, thermalCoalT: 2.4, naturalGasGJ: 0.0561, dieselKl: 2.68, limestoneT: 0.44 }; // tCO2 per unit
const ROUTES = { // plausible total intensity (tCO2/t) and electricity (MWh/t) ranges
  "BF-BOF": { cn: "72", intensity: [1.7, 2.8], elec: [0.1, 0.8], label: "Blast furnace / basic oxygen steel" },
  "DRI-EAF": { cn: "72", intensity: [1.6, 3.4], elec: [0.5, 1.2], label: "Coal DRI + electric arc furnace steel" },
  "Scrap-EAF": { cn: "72", intensity: [0.3, 1.2], elec: [0.35, 0.9], label: "Scrap-based electric arc furnace steel" },
  "Al-primary": { cn: "76", intensity: [8, 22], elec: [12.5, 17], label: "Primary aluminium smelting" },
};
function assess(d) {
  const findings = []; let risk = 0; const route = ROUTES[d.route];
  if (!route) return { riskScore: 100, decision: "BLOCK", findings: [{ severity: "high", msg: `Unknown production route ${d.route}` }] };
  const P = Number(d.productionTonnes); if (!(P > 0)) return { riskScore: 100, decision: "BLOCK", findings: [{ severity: "high", msg: "Production tonnes missing" }] };
  const fuels = d.fuels || {}; let direct = 0; const breakdown = {};
  for (const [k, ef] of Object.entries(EF)) if (fuels[k]) { breakdown[k] = +(fuels[k] * ef).toFixed(1); direct += fuels[k] * ef; }
  const indirect = (d.electricityMWh || 0) * (d.gridFactor ?? 0.71); breakdown.electricity = +indirect.toFixed(1);
  const computed = (direct + indirect) / P, elecPerT = (d.electricityMWh || 0) / P, declared = Number(d.declaredIntensity);
  if (!String(d.cnCode || "").startsWith(route.cn)) { risk += 20; findings.push({ severity: "high", msg: `CN code ${d.cnCode} does not match route ${d.route}` }); }
  if (declared < computed * 0.9) { const gap = 1 - declared / computed; risk += Math.min(50, Math.round(gap * 80) + 10);
    findings.push({ severity: "high", msg: `Declared ${declared} tCO2/t is ${(gap * 100).toFixed(0)}% below the ${computed.toFixed(2)} tCO2/t implied by fuel + electricity data (under-reporting)` }); }
  else findings.push({ severity: "ok", msg: `Declared ${declared} tCO2/t matches activity data (${computed.toFixed(2)} tCO2/t)` });
  const [lo, hi] = route.intensity;
  if (declared < lo) { risk += 25; findings.push({ severity: "high", msg: `Declared intensity ${declared} is below any plausible ${d.route} plant (${lo}–${hi} tCO2/t)` }); }
  if (computed > hi * 1.2) { risk += 10; findings.push({ severity: "medium", msg: `Computed intensity ${computed.toFixed(2)} unusually high for ${d.route}; check units` }); }
  const [elo, ehi] = route.elec;
  if (elecPerT < elo * 0.7 || elecPerT > ehi * 1.3) { risk += 15; findings.push({ severity: "medium", msg: `Electricity ${elecPerT.toFixed(2)} MWh/t outside typical ${elo}–${ehi} MWh/t for ${d.route}` }); }
  if (Array.isArray(d.monthlyProductionT) && d.monthlyProductionT.length) {
    const s = d.monthlyProductionT.reduce((a, b) => a + b, 0);
    if (Math.abs(s - P) / P > 0.05) { risk += 15; findings.push({ severity: "medium", msg: `Monthly production sums to ${s} t but declared ${P} t (mass-balance mismatch)` }); }
  }
  risk = Math.min(100, risk);
  return { riskScore: risk, decision: risk <= 40 ? "PASS" : "BLOCK", computedIntensity: +computed.toFixed(3), declaredIntensity: declared,
    embeddedTCO2: +(computed * P).toFixed(1), electricityPerT: +elecPerT.toFixed(3), breakdown, route: route.label, findings };
}
function commitment(d, salt) { const { salt: _s, ...data } = d; const h = crypto.createHash("sha256"); h.update(Buffer.from(salt.replace(/^0x/, ""), "hex")); return "0x" + h.update(canonical(data)).digest("hex"); }
module.exports = { assess, commitment, EF, ROUTES };
