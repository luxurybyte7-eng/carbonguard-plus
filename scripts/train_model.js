// Train the Isolation Forest on synthetic honest solar projects driven by REAL NASA POWER irradiance, then
// evaluate on held-out honest + 5 fraud types. Run: node scripts/train_model.js  -> ai/model/iforest.json
const fs = require("fs"); const path = require("path"); const ml = require("../ai/ml");
const dir = path.join(__dirname, "../data/nasa");
const sites = fs.readdirSync(dir).filter(f => f.includes("20250101")).map(f => JSON.parse(fs.readFileSync(path.join(dir, f))));
const r = ml.rng(7); const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
function honest() {
  const s = sites[Math.floor(r() * sites.length)]; const days = Object.keys(s.daily); const n = 20 + Math.floor(r() * 21); const st = Math.floor(r() * (days.length - n));
  const cap = [50, 100, 250, 500, 1000][Math.floor(r() * 5)], pr = 0.70 + r() * 0.14, noise = 0.02 + r() * 0.05;
  const readings = days.slice(st, st + n).map(t => ({ t, value: +(cap * s.daily[t] * pr * (1 + noise * gauss()) * (r() < 0.03 ? 0.3 + r() * 0.4 : 1)).toFixed(1) }));
  const sup = readings.reduce((a, x) => a + x.value, 0) / 1000 * 0.71;
  return { d: { projectType: "solar", capacityKw: cap, gridEmissionFactor: 0.71, claimedTonnes: +(sup * (0.85 + r() * 0.17)).toFixed(2), readings }, irr: s };
}
const FRAUD = {
  inflatedClaim: ({ d, irr }) => ({ d: { ...d, claimedTonnes: d.claimedTonnes * (1.4 + r() * 2) }, irr }),
  scaledMeter: ({ d, irr }) => ({ d: { ...d, readings: d.readings.map(x => ({ ...x, value: +(x.value * (1.3 + r() * 0.5)).toFixed(1) })) }, irr }),
  ignoresClouds: ({ d, irr }) => { const m = d.readings.reduce((a, x) => a + x.value, 0) / d.readings.length; return { d: { ...d, readings: d.readings.map(x => ({ ...x, value: +(m * (1 + 0.04 * gauss())).toFixed(1) })) }, irr }; },
  spikes: ({ d, irr }) => ({ d: { ...d, readings: d.readings.map(x => ({ ...x, value: r() < 0.2 ? +(x.value * (1.8 + r())).toFixed(1) : x.value })) }, irr }),
  copyPaste: ({ d, irr }) => ({ d: { ...d, readings: d.readings.map((x, i) => ({ ...x, value: d.readings[i % 3].value })) }, irr }),
};
const toX = s => { const f = ml.features(s.d, s.irr); return f && ml.vec(f); };
const train = Array.from({ length: 3000 }, honest).map(toX).filter(Boolean);
const model = ml.train(train, { trees: 150, sample: 256, seed: 42 });
const trainScores = train.map(x => ml.scoreVec(model, x)).sort((a, b) => a - b);
model.threshold = +trainScores[Math.floor(0.98 * trainScores.length)].toFixed(3); // 2% false-alarm budget on training data
const testH = Array.from({ length: 500 }, honest); const metrics = { heldOutHonestFalseAlarmRate: 0 , detectionRate: {} };
metrics.heldOutHonestFalseAlarmRate = +(testH.filter(s => ml.scoreVec(model, toX(s)) > model.threshold).length / testH.length).toFixed(3);
for (const [k, fn] of Object.entries(FRAUD)) metrics.detectionRate[k] = +(testH.slice(0, 200).map(fn).filter(s => ml.scoreVec(model, toX(s)) > model.threshold).length / 200).toFixed(3);
model.metrics = metrics; model.trainedOn = `${train.length} synthetic honest projects on real NASA POWER irradiance (${sites.length} Indian sites, 2025)`;
fs.writeFileSync(path.join(__dirname, "../ai/model/iforest.json"), JSON.stringify(model));
console.log("threshold", model.threshold, JSON.stringify(metrics, null, 1));
