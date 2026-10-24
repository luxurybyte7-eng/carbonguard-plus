const { expect } = require("chai");
const v = require("../ai/verifier");
const strip = ({ projectId, name, registry, serial, vintage, ...m }) => m;
describe("AI verifier", () => {
  it("passes honest solar data", () => { const r = v.verify(strip(require("../data/honest_solar.json"))); expect(r.decision).to.equal("PASS"); expect(r.riskScore).to.be.at.most(40); });
  it("blocks inflated solar claim with spikes", () => { const r = v.verify(strip(require("../data/fraud_solar.json"))); expect(r.decision).to.equal("BLOCK"); expect(r.findings.some(f => /over-claiming/.test(f.msg))).to.equal(true); });
  it("flags flat-lined data", () => { const r = v.verify({ projectType: "solar", claimedTonnes: 1, readings: Array.from({ length: 20 }, () => ({ value: 400 })) }); expect(r.findings.some(f => /flat/.test(f.msg))).to.equal(true); });
  it("hash is order-independent and ignores claim", () => { expect(v.mrvHash({ a: 1, b: 2, claimedTonnes: 5 })).to.equal(v.mrvHash({ b: 2, a: 1, claimedTonnes: 9 })); });
});
