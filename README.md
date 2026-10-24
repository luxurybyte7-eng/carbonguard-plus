# CarbonGuard: AI-verified carbon credits with on-chain double-counting prevention
**IEEE ClimateChain Global Hackathon 2026 · Track: Carbon Markets & Emissions Transparency**

## Problem
Voluntary carbon markets have a trust crisis.
- Credits get **over-issued**: claims exceed what the measured data supports.
- Credits get **double counted**: the same reduction is sold twice, under two serials or in two registries.
- Credits get claimed again after retirement.
- Verification is slow, manual, and opaque.

## Solution
CarbonGuard puts an **explainable AI verifier** in front of a **smart-contract registry**:
1. A project uploads its MRV data: sensor readings, capacity, and the claimed tCO2e.
2. The **AI verifier** checks the data and returns a 0–100 risk score with plain-English findings. It looks for:
   - robust anomaly detection (MAD z-score),
   - flat-lined or copy-pasted data,
   - physical plausibility (for example PV capacity-factor limits),
   - claim vs. data-supported tonnes (using the India CEA grid factor of 0.71 tCO2/MWh).
3. The verifier **attests** the score on chain against the dataset's canonical SHA-256 **MRV hash**.
4. `issue()` succeeds only if:
   - an attestation exists,
   - the risk is ≤ the threshold (default 40),
   - the registry+serial pair has never been used, **and**
   - the MRV data hash has never been used.

   That last check means the same data can't be resold under a new serial.
5. Credits can be transferred and **retired** permanently to a named beneficiary through an auditable event.

## Architecture
```
MRV data ──> AI verifier (ai/verifier.js) ──risk+hash──> CarbonGuardRegistry.sol (attest → issue → transfer → retire)
                     │                                              │
                     └──────── Web dashboard (public/) via Express API (scripts/server.js) ┘
```
- `contracts/CarbonGuardRegistry.sol`: roles (admin, verifier, issuer), risk gate, serial and MRV uniqueness, and retirement.
- `ai/verifier.js`: a dependency-free, explainable risk model.
- `data/`: an honest solar dataset and a fraudulent one (spikes plus a 3.3× over-claim).

## Run
```bash
npm install
npm test          # 10 tests: contract + AI
npm start         # local in-process chain + dashboard on http://localhost:8787
```
**Testnet only:** `TESTNET_PRIVATE_KEY=<fresh faucet wallet> npm run deploy:amoy`. The deploy script refuses mainnet chain IDs. Never use real funds.

## Demo flow
1. Load the honest project, run AI verification (**PASS, 0/100**), and issue it on chain.
2. Load the fraud project. The AI scores it **85/100**, and the contract reverts with `RiskTooHigh(85)`.
3. Re-submit the honest project. The contract reverts with `DuplicateSerial`, so double counting is blocked.
4. Retire the credits for "Acme Corp". The batch shows as fully retired and can't be re-retired.

Screenshots are in `screenshots/`.

## Impact and scale
- **Who it's for:** registries (Verra, Gold Standard, India's CCTS), project developers, buyers, and auditors.
- **Adoption:** the verifier runs as a pluggable oracle, and the contract is EVM-standard (Polygon, Ethereum L2s).
- **Roadmap:**
  - IoT device signatures,
  - satellite data for reforestation,
  - a decentralized verifier quorum,
  - ERC-1155 credit tokens,
  - cross-registry hash sharing to stop cross-registry double counting.

## Responsible AI and security
- The model is explainable, so every score lists its reasons.
- A human-set threshold controls issuance.
- Only hashes go on chain, so no raw data is exposed.
- Role-based access is enforced, and custom errors are used throughout.

MIT License.
