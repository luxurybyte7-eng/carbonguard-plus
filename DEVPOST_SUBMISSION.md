# Devpost submission draft (DO NOT SUBMIT WITHOUT APPROVAL)
**Project name:** CarbonGuard
**Tagline:** AI-verified carbon credits with on-chain double-counting prevention
**Track:** Carbon Markets & Emissions Transparency
**Built with:** solidity, hardhat, ethers.js, node.js, express, javascript, ai, polygon (testnet)

## Inspiration
The voluntary carbon market has been rocked by reports of over-issued "phantom" credits and by double counting. When buyers can't trust a tonne, real climate projects lose funding. We wanted a registry where **trust is enforced by code**, not by paperwork.

## What it does
- An explainable **AI verifier** scores a project's MRV data from 0 to 100. It checks for sensor anomalies, flat-lined data, physical impossibilities, and over-claiming against data-supported tonnes.
- The score and the dataset's hash are **attested on chain**.
- The **CarbonGuardRegistry** smart contract issues credits only when:
  - the AI risk is ≤ 40,
  - the registry serial has never been used, and
  - the same MRV data has never been used.

  This prevents double counting at the protocol level.
- Credits can be transferred and **permanently retired** to a named beneficiary, with a public audit trail.

## How we built it
- The contract is Solidity 0.8.24 with custom errors and roles (admin, verifier, issuer), tested with Hardhat (10 passing tests).
- The AI is a dependency-free JS model: MAD robust z-score, a plausibility model, and claim reconciliation using the India CEA grid emission factor.
- The dashboard is Express plus vanilla JS. It is deployable to the Polygon Amoy testnet.

## Challenges
- Making the AI **explainable**, so judges and auditors can see why a credit was blocked.
- Designing uniqueness so that re-serialized but identical data is still caught, using a canonical hash.

## Accomplishments
A complete end-to-end flow (verify → attest → issue → block fraud → block double count → retire) running on a local EVM chain, with tests.

## What we learned
Trust problems in climate finance are as much about data integrity as about tokens. AI and blockchain work best together: AI judges the data, and the chain enforces the decision.

## What's next
- Signed IoT meters and satellite NDVI for forestry.
- A multi-verifier quorum.
- ERC-1155 credits.
- A cross-registry hash registry, to stop the same tonne appearing in Verra and Gold Standard.
- A pilot with Indian rooftop-solar cooperatives under the CCTS.

**Links to add:** GitHub repo URL, YouTube video URL, demo URL (optional).

## What's new in CarbonGuard+
- Satellite-verified MRV using the NASA POWER daily irradiance API. Honest Jaipur project: risk 0 (r=0.98). Inflated project: risk 100, blocked on-chain.
- EU CBAM exporter attestation with an importer verify page that detects tampered data.
- Privacy-preserving, zk-ready commitments (HMAC / salted hashes; not a ZK proof yet).
- 16 automated tests, SECURITY.md threat model, and a 4:46 demo video.
- Built with AI agents: OpenClaw (security review) and Paperclip (workstream tracking).
