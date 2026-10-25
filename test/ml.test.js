const { expect } = require("chai");
const ml = require("../ai/ml"); const v = require("../ai/verifier"); const llm = require("../ai/llm");
const strip = ({ projectId, name, registry, serial, vintage, note, ...m }) => m;
const JAIPUR = require("../data/nasa/power_26.91_75.79_20260901_20260930.json"), AHMD = require("../data/nasa/power_23.02_72.57_20260901_20260930.json");
const honest = strip(require("../data/honest_solar.json")), fraud = strip(require("../data/fraud_solar.json"));
describe("ML anomaly model (Isolation Forest)", () => {
  it("trained model meets quality bar on held-out data (<=5% false alarms, catches cloud-ignoring/spike/copy-paste fraud)", () => {
    const m = ml.load().metrics; expect(m.heldOutHonestFalseAlarmRate).to.be.at.most(0.05);
    for (const k of ["ignoresClouds", "spikes", "copyPaste"]) expect(m.detectionRate[k]).to.be.at.least(0.9);
  });
  it("honest Jaipur project scores normal; fraud project scores anomalous", () => {
    expect(ml.assess(honest, JAIPUR).anomalous).to.equal(false);
    const f = ml.assess(fraud, AHMD); expect(f.anomalous).to.equal(true); expect(f.score).to.be.above(f.threshold);
  });
  it("is explainable: names the out-of-range features with reasons", () => {
    const f = ml.assess(fraud, AHMD); const out = f.reasons.filter(r => r.outside);
    expect(out.length).to.be.at.least(1); expect(out[0].why).to.be.a("string").and.not.empty; expect(out[0]).to.have.keys("feature", "label", "value", "typical", "z", "outside", "why");
  });
  it("copy-pasted readings are caught by the model", () => {
    const d = { ...honest, readings: honest.readings.map((r, i) => ({ ...r, value: honest.readings[i % 3].value })) };
    expect(ml.assess(d, JAIPUR).anomalous).to.equal(true);
  });
  it("verifier includes the ML verdict and still PASSes honest / BLOCKs fraud", () => {
    const h = v.verify(honest, { irradiance: JAIPUR }), f = v.verify(fraud, { irradiance: AHMD });
    expect(h.ml.anomalous).to.equal(false); expect(h.decision).to.equal("PASS");
    expect(f.findings.some(x => /ML anomaly model/.test(x.msg))).to.equal(true); expect(f.decision).to.equal("BLOCK");
  });
});
describe("Fail-closed verifier", () => {
  it("missing satellite data adds risk instead of lowering scrutiny", () => {
    const a = v.verify(honest, { irradiance: JAIPUR }), b = v.verify(honest);
    expect(b.riskScore).to.be.above(a.riskScore - (a.satellite ? 0 : 0)); expect(b.findings.some(f => /fail-closed/.test(f.msg))).to.equal(true);
  });
  it("malformed readings are blocked", () => {
    const r = v.verify({ ...honest, readings: honest.readings.map((x, i) => i ? x : { ...x, value: "abc" }) }, { irradiance: JAIPUR });
    expect(r.decision).to.equal("BLOCK");
  });
});
describe("LLM audit summary", () => {
  it("falls back to a deterministic template without an API key", async () => {
    const s = await llm.summarize(v.verify(fraud, { irradiance: AHMD }), { key: "" });
    expect(s.source).to.equal("template"); expect(s.text).to.match(/^Decision: BLOCK/);
  });
  it("falls back gracefully on API error (bad key)", async () => {
    const s = await llm.summarize(v.verify(honest, { irradiance: JAIPUR }), { key: "sk-invalid", timeoutMs: 8000 });
    expect(s.source).to.equal("template"); expect(s.note).to.match(/LLM unavailable/);
  }).timeout(15000);
});
