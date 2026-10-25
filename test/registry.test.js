const { expect } = require("chai");
const { ethers } = require("hardhat");
const H = s => ethers.keccak256(ethers.toUtf8Bytes(s));
describe("CarbonGuardRegistry", () => {
  let reg, admin, oracle, issuer, buyer, rando;
  const mrv = H("dataset-1"), proj = H("IN-RJ-SOLAR-001");
  const att = (m, amt, score, p = proj, v = 2026) => reg.connect(oracle).attest(m, p, amt, v, score, "ipfs://report");
  const iss = (serial, amt, m, p = proj, v = 2026) => reg.connect(issuer).issue(p, "CG", serial, v, amt, m);
  beforeEach(async () => {
    [admin, oracle, issuer, buyer, rando] = await ethers.getSigners();
    reg = await (await ethers.getContractFactory("CarbonGuardRegistry")).deploy(oracle.address, issuer.address);
  });
  it("blocks issuance without AI attestation", async () => {
    await expect(iss("S1", 8, mrv)).to.be.revertedWithCustomError(reg, "NotAttested");
  });
  it("issues low-risk credits", async () => {
    await att(mrv, 8, 10);
    await expect(iss("S1", 8, mrv)).to.emit(reg, "Issued");
    expect(await reg.batchCount()).to.equal(1n);
  });
  it("blocks high-risk (AI-flagged) credits", async () => {
    await att(mrv, 40, 85);
    await expect(iss("S1", 40, mrv)).to.be.revertedWithCustomError(reg, "RiskTooHigh").withArgs(85);
  });
  it("prevents double counting: same serial or same MRV data", async () => {
    const mrv2 = H("dataset-2");
    await att(mrv, 8, 0); await att(mrv2, 8, 0);
    await iss("S1", 8, mrv);
    await expect(iss("S1", 8, mrv2)).to.be.revertedWithCustomError(reg, "DuplicateSerial");
    await expect(iss("S2", 8, mrv)).to.be.revertedWithCustomError(reg, "DuplicateMrvData");
  });
  it("transfers and retires permanently; cannot retire twice", async () => {
    await att(mrv, 8, 0); await iss("S1", 8, mrv);
    const id = await reg.batchIds(0);
    await reg.connect(issuer).transfer(id, buyer.address, 5);
    await expect(reg.connect(buyer).retire(id, 5, "Acme Corp", "FY26 offset")).to.emit(reg, "Retired");
    await expect(reg.connect(buyer).retire(id, 1, "Acme Corp", "again")).to.be.revertedWithCustomError(reg, "InsufficientBalance");
    expect((await reg.batches(id)).retired).to.equal(5n);
  });
  it("only verifiers attest and only issuers issue", async () => {
    await expect(reg.connect(rando).attest(mrv, proj, 8, 2026, 0, "")).to.be.revertedWithCustomError(reg, "NotVerifier");
    await att(mrv, 8, 0);
    await expect(reg.connect(rando).issue(proj, "CG", "S1", 2026, 8, mrv)).to.be.revertedWithCustomError(reg, "NotIssuer");
  });
  it("roles are separate keys: admin can neither attest nor issue; issuer cannot attest", async () => {
    await expect(reg.connect(admin).attest(mrv, proj, 8, 2026, 0, "")).to.be.revertedWithCustomError(reg, "NotVerifier");
    await expect(reg.connect(issuer).attest(mrv, proj, 8, 2026, 0, "")).to.be.revertedWithCustomError(reg, "NotVerifier");
    await att(mrv, 8, 0);
    await expect(reg.connect(admin).issue(proj, "CG", "S1", 2026, 8, mrv)).to.be.revertedWithCustomError(reg, "NotIssuer");
    await expect(reg.connect(rando).setVerifier(rando.address, true)).to.be.revertedWithCustomError(reg, "NotAdmin");
  });
  it("attestation is bound to amount, project and vintage (no over-issuing on an approval)", async () => {
    await att(mrv, 8, 5);
    await expect(iss("S1", 40, mrv)).to.be.revertedWithCustomError(reg, "NotAttested");
    await expect(iss("S1", 8, mrv, H("other-project"))).to.be.revertedWithCustomError(reg, "NotAttested");
    await expect(iss("S1", 8, mrv, proj, 2025)).to.be.revertedWithCustomError(reg, "NotAttested");
    await expect(iss("S1", 8, mrv)).to.emit(reg, "Issued");
  });
  it("a blocked score cannot be overwritten by re-attesting the same terms", async () => {
    await att(mrv, 8, 90);
    await expect(att(mrv, 8, 0)).to.be.revertedWithCustomError(reg, "AlreadyAttested");
  });
});
