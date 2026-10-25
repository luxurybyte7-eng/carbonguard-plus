# Devpost final submission: CarbonGuard+

## Project name
CarbonGuard+

## Elevator pitch
AI + NASA satellite data verify carbon credits before a smart contract issues them, blocking over-claims and double counting, plus CBAM emissions attestations EU importers can verify.

## Track
Carbon Markets & Emissions Transparency

## Built with
solidity, hardhat, ethers.js, node.js, express, javascript, nasa-power-api, sha-256, hmac, html, css, isolation-forest (machine learning), openrouter (llm), pm2, cloudflare-tunnel

## Links
- GitHub: https://github.com/luxurybyte7-eng/carbonguard-plus
- Video demo: https://youtu.be/o0IkQtv9OPE
- Live demo: https://coupons-holes-thereof-zones.trycloudflare.com (public and rate-limited; runs on an in-process Hardhat chain, not a public testnet)

---

## Inspiration
Voluntary carbon markets have a trust problem. Investigations keep finding "phantom" credits that were over-issued, and the same tonne sold twice. India is launching its Carbon Credit Trading Scheme (CCTS) and Indian exporters now face the EU's CBAM reporting, so verifiable emissions data matters more every year. We wanted trust enforced by code and physics, not paperwork.

## What it does
- **Explainable AI verifier:** scores a project's MRV data from 0 to 100. It looks for robust anomalies (MAD z-score), flat-lined or copy-pasted data, physically impossible output (PV capacity-factor limits), and claims above what the data supports (India CEA grid factor 0.71 tCO2/MWh). Every score comes with plain-English reasons.
- **NASA POWER satellite cross-check:** reported solar output is compared against real daily sunlight for the site's coordinates. An honest Jaipur project tracks it (r = 0.98, risk 0). A fake one that exceeds the available sunlight and ignores cloudy days gets risk 100 and is blocked. Weather-normalisation keeps genuinely cloudy days from causing false alarms.
- **On-chain gate (CarbonGuardRegistry.sol):** credits are issued only if a verifier has attested the data, risk is ≤ 40, the registry+serial has never been used, and the MRV fingerprint has never been used.
- **Double-counting prevention:** re-submitting the same data under a new serial reverts with `DuplicateMRV`, and reusing a serial reverts with `DuplicateSerial`. Retired credits can't be retired again.
- **Transfer and permanent retirement:** credits are retired to a named beneficiary with a public event trail.
- **CBAM attestation (CBAMAttestation.sol + /cbam and /verify pages):** an exporter's embedded emissions (for example steel) are AI-checked against production-route benchmarks, so under-declared "green steel" gets flagged. Then a salted commitment is attested on chain. An EU importer opens the verify page, enters the disclosed data and salt, and sees VALID, or TAMPERED if a single number was changed. Duplicates are blocked, high-risk attestations are rejected, and attestations can be revoked.
- **Privacy:** only HMAC-blinded fingerprints and salted SHA-256 commitments go on chain, never raw data. The design is "zk-ready": a ZK proof could later replace the reveal step. It is not a zero-knowledge proof today.

## How we built it
- **Contracts:** Solidity 0.8.24 with role checks (admin, verifier, issuer) and custom errors, built and tested with Hardhat and ethers.js.
- **AI:** dependency-free JavaScript modules (`ai/verifier.js`, `ai/satellite.js`, `ai/cbam.js`), so every decision is explainable.
- **Satellite data:** the NASA POWER daily irradiance API.
- **App:** an Express API plus a vanilla JS dashboard, running against an in-process local Hardhat chain at localhost:8787.
- **Tests:** 28 automated tests (`npx hardhat test`) cover issuance gating, fraud blocking, double counting, retirement, roles, the satellite cross-check, blinded hashes, and the CBAM attest/verify/tamper/revoke flow.
- **ML model:** a pure-JS Isolation Forest (150 trees) trained on 3,000 synthetic honest solar projects built from real NASA POWER irradiance for 6 Indian cities. On held-out data it gives 2.2% false alarms and catches 93.5% of cloud-ignoring data, 99% of spike edits and 100% of copy-paste data. It is weak on pure claim inflation (4.5%), which the rule layer catches. Every verdict names the features outside the honest range.
- **LLM audit summary:** a plain-English summary through OpenRouter (deepseek-chat). It only explains the result and never changes the score, and it falls back to a template if the LLM is unavailable.
- **AI agents:** an OpenClaw agent did an independent security review (`docs/OPENCLAW_REVIEW.md`). We fixed its findings #1 (separate admin, AI-oracle and issuer keys; rate-limited public API), #2 (approval bound to amount, project, vintage and chain, and can't be overwritten), #4 and #7 (fail-closed scoring), plus the path-traversal issue. Findings #3, #5 and #6 remain open.

## Challenges we ran into
- **Explainability:** auditors need to see *why* a credit was blocked, not just a number.
- **Dedupe that survives tricks:** cosmetic edits (notes, field order, the claim) must not create a "new" dataset, so the fingerprint is computed over canonical readings.
- **No false positives on cloudy days:** satellite checks had to weather-normalise so that honest projects pass.
- **Privacy vs. verifiability:** we needed commitments that an importer can check without publishing raw commercial data.
- **Testnet:** public faucets were blocked by captchas, so **nothing is deployed to a public testnet yet**. Instead, judges can use a public hosted demo (https://coupons-holes-thereof-zones.trycloudflare.com) that runs the real contracts on an in-process Hardhat chain on our server. That chain resets on restart. Deploy scripts for Sepolia and Polygon Amoy are included.

## Accomplishments that we're proud of
- A complete working flow on a local EVM chain with 28 passing tests: verify → satellite cross-check → attest → issue → block fraud → block double count → retire.
- The flow uses real NASA satellite data, not mocked thresholds.
- A CBAM verify page that catches a single tampered number.
- An honest, documented threat model, including an external AI review of our own weak spots.

## What we learned
- Carbon-market trust is mostly a data-integrity problem. AI judges the data, physics (satellites) bounds what is possible, and the chain enforces the decision permanently.
- Hashing isn't privacy. Low-entropy IDs can be enumerated, and the OpenClaw review made us state our privacy claims precisely.

## What's next for CarbonGuard+
- Deploy to the Polygon Amoy testnet, then pilot with Indian rooftop-solar cooperatives under CCTS.
- Put the admin role behind a multisig and move to EIP-712 signed attestations; add fuzzy dedupe across registries (review finding 3).
- Tolerance-bucketed fingerprints, normalised registry IDs, and a cross-registry hash registry to stop the same tonne appearing in both Verra and Gold Standard.
- Signed IoT meters, satellite NDVI for forestry, a multi-verifier quorum, ERC-1155 credits, and real ZK proofs for CBAM disclosures.
