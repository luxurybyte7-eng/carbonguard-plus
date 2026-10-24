const { expect } = require("chai");
const { ethers } = require("hardhat");
const H = s => ethers.keccak256(ethers.toUtf8Bytes(s));
describe("CarbonGuardRegistry", () => {
  let reg, admin, buyer, rando;
  const mrv = H("dataset-1"), proj = H("IN-RJ-SOLAR-001");
  beforeEach(async () => {
    [admin, buyer, rando] = await ethers.getSigners();
    reg = await (await ethers.getContractFactory("CarbonGuardRegistry")).deploy();
  });
  it("blocks issuance without AI attestation", async () => {
    await expect(reg.issue(proj, "CG", "S1", 2026, 8, mrv)).to.be.revertedWithCustomError(reg, "NotAttested");
  });
  it("issues low-risk credits", async () => {
    await reg.attest(mrv, 10, "ipfs://report");
    await expect(reg.issue(proj, "CG", "S1", 2026, 8, mrv)).to.emit(reg, "Issued");
    expect(await reg.batchCount()).to.equal(1n);
  });
  it("blocks high-risk (AI-flagged) credits", async () => {
    await reg.attest(mrv, 85, "ipfs://report");
    await expect(reg.issue(proj, "CG", "S1", 2026, 40, mrv)).to.be.revertedWithCustomError(reg, "RiskTooHigh").withArgs(85);
  });
  it("prevents double counting: same serial or same MRV data", async () => {
    const mrv2 = H("dataset-2");
    await reg.attest(mrv, 0, ""); await reg.attest(mrv2, 0, "");
    await reg.issue(proj, "CG", "S1", 2026, 8, mrv);
    await expect(reg.issue(proj, "CG", "S1", 2026, 8, mrv2)).to.be.revertedWithCustomError(reg, "DuplicateSerial");
    await expect(reg.issue(proj, "CG", "S2", 2026, 8, mrv)).to.be.revertedWithCustomError(reg, "DuplicateMrvData");
  });
  it("transfers and retires permanently; cannot retire twice", async () => {
    await reg.attest(mrv, 0, "");
    await reg.issue(proj, "CG", "S1", 2026, 8, mrv);
    const id = await reg.batchIds(0);
    await reg.transfer(id, buyer.address, 5);
    await expect(reg.connect(buyer).retire(id, 5, "Acme Corp", "FY26 offset")).to.emit(reg, "Retired");
    await expect(reg.connect(buyer).retire(id, 1, "Acme Corp", "again")).to.be.revertedWithCustomError(reg, "InsufficientBalance");
    expect((await reg.batches(id)).retired).to.equal(5n);
  });
  it("only verifiers attest and only issuers issue", async () => {
    await expect(reg.connect(rando).attest(mrv, 0, "")).to.be.revertedWithCustomError(reg, "NotVerifier");
    await reg.attest(mrv, 0, "");
    await expect(reg.connect(rando).issue(proj, "CG", "S1", 2026, 8, mrv)).to.be.revertedWithCustomError(reg, "NotIssuer");
  });
});
