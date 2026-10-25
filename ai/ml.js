// CarbonGuard ML anomaly model: Isolation Forest (Liu, Ting & Zhou 2008), pure JS, no dependencies.
// Trained by scripts/train_model.js on synthetic solar MRV datasets built from REAL NASA POWER daily irradiance
// (6 Indian cities, 2025). Unsupervised: it learns what honest PV data looks like; fraud = "easy to isolate".
const fs = require("fs"); const path = require("path");
const MODEL_FILE = path.join(__dirname, "model/iforest.json");

const FEATURES = [
  { key: "prMean", label: "Performance ratio (output ÷ satellite sunlight)", hi: "output is higher than the sunlight allows", lo: "output is far below what the sunlight allows" },
  { key: "prCv", label: "Day-to-day variability of performance ratio", hi: "daily output swings wildly relative to sunlight (spikes / edits)", lo: "performance ratio is suspiciously constant" },
  { key: "corr", label: "Correlation of output with satellite sunlight", hi: "", lo: "output does not follow cloudy/sunny days" },
  { key: "prMax", label: "Best single day performance ratio", hi: "at least one day is physically implausible", lo: "" },
  { key: "uniq", label: "Share of unique readings", hi: "", lo: "readings repeat (copy-paste / flat-line)" },
  { key: "claimRatio", label: "Claimed tonnes ÷ data-supported tonnes", hi: "claim is larger than the meter data supports", lo: "" },
];
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const std = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const pearson = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / (Math.sqrt(da * db) || 1e-9); };

/** Feature vector for a solar dataset + NASA irradiance. Returns null if < 7 overlapping days. */
function features(d, irr) {
  const p = (d.readings || []).filter(r => irr && irr.daily[r.t] > 0).map(r => ({ k: Number(r.value), g: irr.daily[r.t] }));
  if (p.length < 7 || !d.capacityKw) return null;
  const pr = p.map(x => x.k / (d.capacityKw * x.g));
  const kwh = p.reduce((s, x) => s + x.k, 0), sup = kwh / 1000 * (d.gridEmissionFactor ?? 0.71);
  return { prMean: kwh / p.reduce((s, x) => s + d.capacityKw * x.g, 0), prCv: std(pr) / (mean(pr) || 1e-9), corr: pearson(p.map(x => x.k), p.map(x => x.g)),
    prMax: Math.max(...pr), uniq: new Set(p.map(x => x.k.toFixed(1))).size / p.length, claimRatio: (d.claimedTonnes ?? sup) / Math.max(sup, 1e-9) };
}
const vec = f => FEATURES.map(x => f[x.key]);

// ---- Isolation Forest ----
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const c = n => n <= 1 ? 0 : 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
function build(X, depth, maxDepth, r) {
  if (depth >= maxDepth || X.length <= 1) return { s: X.length };
  const q = Math.floor(r() * X[0].length); const vals = X.map(x => x[q]); const lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-12) return { s: X.length };
  const t = lo + r() * (hi - lo);
  return { q, t, l: build(X.filter(x => x[q] < t), depth + 1, maxDepth, r), r: build(X.filter(x => x[q] >= t), depth + 1, maxDepth, r) };
}
function pathLen(x, n, d = 0) { return n.s !== undefined ? d + c(n.s) : pathLen(x, x[n.q] < n.t ? n.l : n.r, d + 1); }
function train(X, { trees = 150, sample = 256, seed = 42 } = {}) {
  const r = rng(seed); const psi = Math.min(sample, X.length); const maxDepth = Math.ceil(Math.log2(psi));
  const forest = Array.from({ length: trees }, () => build(Array.from({ length: psi }, () => X[Math.floor(r() * X.length)]), 0, maxDepth, r));
  const cols = FEATURES.map((_, j) => X.map(x => x[j]));
  return { type: "IsolationForest", features: FEATURES.map(f => f.key), psi, forest, stats: cols.map(col => ({ mean: mean(col), std: std(col) || 1e-9, p01: quant(col, 0.01), p99: quant(col, 0.99) })) };
}
function quant(a, q) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; }
/** Anomaly score in (0,1): ~0.5 normal, > threshold = anomalous (standard iForest normalisation). */
function scoreVec(model, x) { const h = mean(model.forest.map(t => pathLen(x, t))); return Math.pow(2, -h / c(model.psi)); }

let _model = null;
const load = () => (_model ||= JSON.parse(fs.readFileSync(MODEL_FILE, "utf8")));

/** Explainable ML verdict: anomaly score + the features that are outside the honest-training range. */
function assess(d, irr, model = load()) {
  const f = features(d, irr); if (!f) return null;
  const x = vec(f); const score = scoreVec(model, x);
  const reasons = FEATURES.map((ft, j) => { const st = model.stats[j], z = (x[j] - st.mean) / st.std; const out = x[j] > st.p99 ? "hi" : x[j] < st.p01 ? "lo" : null;
    return { feature: ft.key, label: ft.label, value: +x[j].toFixed(3), typical: `${st.p01.toFixed(2)}–${st.p99.toFixed(2)}`, z: +z.toFixed(1), outside: !!out, why: out ? ft[out] || `${ft.label} outside honest range` : "" }; })
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const anomalous = score > model.threshold;
  return { model: `IsolationForest(${model.forest.length} trees, trained on ${model.trainedOn})`, score: +score.toFixed(3), threshold: model.threshold, anomalous,
    risk: anomalous ? Math.min(25, Math.round((score - model.threshold) * 200) + 10) : 0, reasons, metrics: model.metrics };
}
module.exports = { FEATURES, features, vec, train, scoreVec, assess, load, rng };
