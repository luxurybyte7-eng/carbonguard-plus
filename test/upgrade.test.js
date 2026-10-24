const { expect } = require("chai"); const { ethers } = require("hardhat");
const v = require("../ai/verifier"); const sat = require("../ai/satellite"); const cbam = require("../ai/cbam");
const strip = ({ projectId, name, registry, serial, vintage, note, ...m }) => m;
const JAIPUR = require("../data/nasa/power_26.91_75.79_20260901_20260930.json"), AHMD = require("../data/nasa/power_23.02_72.57_20260901_20260930.json");
describe("Upgrade: NASA satellite cross-check", () => {
  it("honest project tracks real NASA irradiance (r>0.9) and passes", () => {
    const r = v.verify(strip(require("../data/honest_solar.json")), { irradiance: JAIPUR });
    expect(r.satellite.correlation).to.be.above(0.9); expect(r.decision).to.equal("PASS");
  });
  it("fake project: output exceeds sunlight and ignores clouds -> satellite findings + BLOCK", () => {
    const c = sat.crossCheck(strip(require("../data/fraud_solar.json")), AHMD);
    expect(c.risk).to.be.above(40); expect(c.findings.filter(f => /^Satellite/.test(f.msg)).length).to.equal(3);
  });
  it("cloudy days are not false-positive anomalies when weather-normalised", () => {
    const d = strip(require("../data/honest_solar.json"));
    expect(v.verify(d, { irradiance: JAIPUR }).findings.some(f => /anomalous/.test(f.msg))).to.equal(false);
  });
});
describe("Upgrade: zk-ready blinded hashes", () => {
  it("blinded fingerprint is deterministic per key (dedupe still works) but differs from plain hash", () => {
    const d = { a: 1 }, k = v.newSalt();
    expect(v.mrvHash(d, k)).to.equal(v.mrvHash({ a: 1 }, k)); expect(v.mrvHash(d, k)).to.not.equal(v.mrvHash(d)); expect(v.mrvHash(d, k)).to.not.equal(v.mrvHash(d, v.newSalt()));
  });
});
describe("Upgrade: CBAM module", () => {
  it("AI passes consistent exporter and flags under-declared 'green steel'", () => {
    expect(cbam.assess(require("../data/cbam_honest.json")).decision).to.equal("PASS");
    const f = cbam.assess(require("../data/cbam_fraud.json")); expect(f.decision).to.equal("BLOCK");
    expect(f.findings.some(x => /under-reporting/.test(x.msg))).to.equal(true); expect(f.findings.some(x => /mass-balance/.test(x.msg))).to.equal(true);
  });
  it("on-chain attestation: verify with disclosed data+salt, detect tampering, block high risk & duplicates, revoke", async () => {
    const [admin, rando] = await ethers.getSigners();
    const c = await (await ethers.getContractFactory("CBAMAttestation")).deploy();
    const d = require("../data/cbam_honest.json"), salt = v.newSalt(), com = cbam.commitment(d, salt);
    const tx = await c.attest(com, ethers.id(d.exporterId), "7208", 2026, 3, 12000, 2318, 0); const rc = await tx.wait();
    const id = rc.logs.map(l => c.interface.parseLog(l)).find(e => e.name === "Attested").args.id;
    expect(await c.verify(id, cbam.commitment(d, salt))).to.equal(true);
    expect(await c.verify(id, cbam.commitment({ ...d, electricityMWh: 1 }, salt))).to.equal(false);
    await expect(c.attest(com, ethers.id("x"), "7208", 2026, 3, 1, 1, 0)).to.be.revertedWithCustomError(c, "DuplicateCommitment");
    await expect(c.attest(ethers.id("y"), ethers.id("x"), "7208", 2026, 3, 1, 1, 90)).to.be.revertedWithCustomError(c, "RiskTooHigh").withArgs(90);
    await expect(c.connect(rando).attest(ethers.id("z"), ethers.id("x"), "7208", 2026, 3, 1, 1, 0)).to.be.revertedWithCustomError(c, "NotVerifier");
    await c.revoke(id, "audit finding"); expect(await c.verify(id, com)).to.equal(false);
  });
});
