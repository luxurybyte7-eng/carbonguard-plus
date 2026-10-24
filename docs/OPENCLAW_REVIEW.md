# CarbonGuard — Security & Design Review

Scope: `contracts/CarbonGuardRegistry.sol`, `contracts/CBAMAttestation.sol`, `ai/{verifier,cbam,satellite}.js`, `scripts/server.js`.
Solc `^0.8.24`; no overflows (checked arithmetic), no reentrancy surface (no external calls). Findings below are ordered by impact.

---

## Top 8 Findings

### 1. CRITICAL — One hot key is admin + verifier + issuer, and the API is unauthenticated
**File:** `contracts/CarbonGuardRegistry.sol` (constructor), `contracts/CBAMAttestation.sol` (constructor), `scripts/server.js`

`constructor() { admin = msg.sender; verifiers[msg.sender] = true; issuers[msg.sender] = true; }` — the deployer self-attests and self-issues. `server.js` then calls `reg.attest()` and `reg.issue()` from that same `signers[0]`, exposed through `POST /api/submit` with **no auth, no rate limit, no CORS policy**, bound to `0.0.0.0:8787`. Anyone on the network can drive the oracle and mint credits. The entire "independent AI verifier" premise is a single Express process holding one private key.

**Fix:** Split roles (admin ≠ verifier ≠ issuer) behind a multisig + timelock. Make attestations *signed messages* (EIP-712: `{mrvHash, riskScore, projectId, amount, deadline, nonce}`) verified on-chain, so the issuer cannot self-approve. Add API auth (mTLS or signed requests), CORS allow-list, rate limiting, and bind to `127.0.0.1`.

---

### 2. CRITICAL — Attestation does not bind amount or project terms; approval is replayable against different terms
**File:** `ai/verifier.js` (`mrvHash`), `contracts/CarbonGuardRegistry.sol` (`attest`, `issue`)

`mrvHash(d, salt)` explicitly strips `claimedTonnes` and `note`; `server.js` `strip()` also removes `projectId, name, registry, serial, vintage` before hashing. So the attested value covers *only sensor readings* — not the tonnage, project, vintage, or serial. `attest(mrvHash, riskScore)` likewise commits to nothing but the hash.

Consequences: the AI computes its over-claiming ratio using `claimedTonnes`, but the on-chain approval carries no amount. An issuer key (or a compromised server) can take a genuine low-risk attestation and issue an arbitrary `amount`, or attach it to a different `projectId`/`vintage`. An auditor reading the chain cannot reconstruct what the AI actually approved.

**Fix:** Commit to the full issuance tuple: `keccak256(abi.encode(projectId, registryHash, serialHash, vintage, amount, mrvHash, verifier, deadline, chainid, nonce))`, sign it, verify the signature in `issue()`, and store it. Reject if `block.timestamp > deadline`.

---

### 3. CRITICAL — Double-counting protection is evadable by construction
**File:** `contracts/CarbonGuardRegistry.sol` (`usedSerial`, `usedMrv`), `ai/verifier.js`

Dedupe rests on two exact-match hashes:
- `usedSerial[keccak(registry|serial)]` — raw string compare, no normalization, so `"Verra"` / `"verra"` / `"VERRA "` / `"Verra Registry"` are four distinct keys. The same project can be re-registered across real-world registries (Verra vs. Gold Standard) with different serials.
- `usedMrv[mrvHash]` — hash of exact float readings. Changing one reading from `412.0` to `412.001` produces a new hash, so the same physical MRV dataset can be issued twice. `verifier.js` even notes readings are hashed as-is via `toFixed`-free `canonical()`.

There is no `projectId` uniqueness check, no geolocation + time-window key, no aggregate cap per project, and no chain ID in `batchId`/`mrvHash` (unlike CBAM, which does include `block.chainid`).

**Fix:** Enforce one active batch per `(projectId, vintage)` with an aggregate tonnage cap; key dedupe on a tolerance-bucketed fingerprint (quantized readings + rounded tonnage) rather than exact floats; normalize registry names through an allow-listed enum; include `block.chainid` in all IDs; add a cross-registry/cross-chain reconciliation step before issuance.

---

### 4. HIGH — `abi.encodePacked` string concatenation is collision-prone
**File:** `contracts/CarbonGuardRegistry.sol` (`issue`)

`keccak256(abi.encodePacked(registry, "|", serial))` — a registry value containing `"|"` collides: `("a|", "b")` and `("a", "|b")` both encode to `a||b`. Two distinct real-world serials can then share a dedupe key (or, with crafted values, one serial can occupy another's slot). Same pattern in `batchId = keccak(serialKey, mrvHash)` (benign, both fixed-width).

**Fix:** `keccak256(abi.encode(registry, serial))` — length-prefixed encoding removes ambiguity. Normalize + length-limit the inputs.

---

### 5. HIGH — `CBAMAttestation.verify()` is vacuous, and the stored intensity is a rounded derivative
**File:** `contracts/CBAMAttestation.sol` (`verify`, `get`), `scripts/server.js`

`get(id)` returns the full struct **including `commitment`**, and `verify(id, commitment)` just compares the caller's argument to that public value. Passing `commitment` from `get()` returns `true` unconditionally — the check proves nothing. Real verification only happens off-chain in `server.js` (`cbam.commitment(data, salt)`), making the on-chain function decorative.

Separately, `server.js` stores `Math.round(ai.computedIntensity * 1000)` and `Math.round(d.productionTonnes)`, while `cbam.assess()` compares the full-precision values against route benchmarks. An auditor recomputing from chain data can land on the other side of a `1.7`/`2.8` tCO₂/t boundary and reach a different verdict than the AI did.

**Fix:** Verify an EIP-712 signature from the verifier over `(commitment, exporterId, cnCode, year, quarter, tonnes, intensity, riskScore)`; expose `verify` as "recompute hash of disclosed `(data, salt)` and compare" off-chain only, and drop the misleading on-chain function. Store intensity in kg with fixed precision (e.g. `uint32` gCO₂/t) and score against the same precision used on-chain.

---

### 6. HIGH — Privacy claims are overstated; several "protected" fields are trivially reversible
**File:** `contracts/CBAMAttestation.sol`, `ai/verifier.js` (`mrvHash`), `ai/cbam.js` (`commitment`), `scripts/server.js`

- `exporterId = keccak256(IEC/EORI)` — IEC is 10 alphanumeric characters and EORI is structured (`IN` + 12 digits). Both are enumerable; keccak is not a privacy primitive. The exporter is trivially re-identified.
- `tonnesProduct`, `embeddedKgCO2PerT`, `cnCode`, `year`, `quarter` are stored **in plaintext** — that is commercially sensitive production and emissions intensity data, published per exporter per quarter. The commitment protects nothing that is not already exposed alongside it.
- `cbam.commitment` is unkeyed `sha256(salt || canonical(data))` over low-entropy structured data → dictionary attack once the salt leaks. And the salt *is* returned to the caller in the `/api/cbam/attest` response, over plain HTTP, and never persisted server-side: lose it and the record is unverifiable forever; leak it and the commitment is open.
- `mrvHash` uses HMAC with one global blinding key for every project. Deterministic and global → cross-project linkability (identical readings across sites map to identical hashes), and a single key compromise forks every historical hash.
- Because the key is never disclosed, **no third party can recompute `mrvHash` at all** — the hash is unverifiable by design, which is the opposite of the stated "verifiable" goal.
- `sha256(salt || data)` has no length prefix between salt and payload; safe only while salt is exactly 32 bytes, which is never validated.

**Fix:** Keep raw tonnage/intensity off-chain and store only coarse aggregates (or range commitments). Use per-record random salts persisted with the record, published selectively. For exporter identity use a committed opaque ID with a ZK membership proof, not a hash of an enumerable ID. State plainly that this is a keyed commitment scheme, not ZK, and that `mrvHash` is oracle-internal.

---

### 7. HIGH — The risk scorer fails open and is evadable with malformed input
**File:** `ai/verifier.js`, `ai/satellite.js`, `ai/cbam.js`

- Unknown `projectType` → `expected === null` → the entire consistency check is skipped. Seven fabricated readings for `projectType: "foo"` score `risk 0` → `PASS`.
- Missing or non-numeric `claimedTonnes` → `ratio` is `NaN`; `NaN > 1.1` is `false` → no over-claim penalty → `PASS`.
- `Number(r.value)` on `"abc"` yields `NaN`; `anomalies()` computes `NaN` z-scores that silently fail `|z| > 3.5`, so poisoned readings suppress detection. No range/type validation on readings, negative values, or duplicate timestamps.
- `satelliteFor()` returns `null` on any NASA failure (timeout, bad date range, missing `location`), and the caller merely appends a `"medium"` finding worth **0 risk points**. Breaking the oracle *lowers* scrutiny. `crossCheck` also returns `risk: 15` when `<7` days overlap — the only fail-closed path.
- MAD-based detection has a 50% breakdown point: if the attacker controls most readings, the median and MAD move with them and nothing is flagged.
- Decision threshold `40` is duplicated in JS (`risk <= 40`) and Solidity (`maxRiskScore = 40`, admin-settable to 100), so the two can disagree.

**Fix:** Allow-list `projectType`/`route`, reject non-finite or out-of-range values with an explicit `BLOCK`, treat satellite unavailability as elevated risk (fail closed), cap contributions per check to prevent single-signal evasion, and derive the on-chain threshold from a single source. Add a `minReadings` requirement tied to the claim period.

---

### 8. HIGH — `server.js`: destructive endpoint open to anyone, and path traversal in the cache filename
**File:** `scripts/server.js`, `ai/satellite.js`

- `POST /api/retire` accepts `{batchId, amount, beneficiary}` from any caller and executes as `admin`. Since retirement is **permanent and irreversible**, anyone can burn the operator's entire credit balance. No auth, no ownership check.
- `POST /api/submit` will attest + issue for any caller at the operator's gas expense — unbounded griefing.
- `cacheFile(lat, lon, start, end)` interpolates client-controlled `location.lat/lon` and reading timestamps into a path joined with `path.join`. `lat: "../../../.secrets/x"` escapes `data/nasa/`, and `fs.existsSync` + `readFileSync` + `writeFileSync` then read/write arbitrary JSON-shaped paths. Also unvalidated `lat/lon` in the NASA URL allows query-parameter injection (`lat=1&community=XX`).
- `range()` calls `.replace()` on `r.t`; a non-string timestamp throws → unhandled 500 (trivial DoS).
- `/api/batches` loops `await` per batch over an unbounded array — O(n) RPC round-trips that will not survive a few thousand batches.

**Fix:** Require auth and enforce `balanceOf`-owner checks on retire. Validate `lat ∈ [-90,90]`, `lon ∈ [-180,180]`, `^\d{4}-\d{2}-\d{2}$` dates; derive cache filenames from a hash of the parameters, not the raw values. Wrap handlers in try/catch with 4xx responses. Paginate `/api/batches` and read `batchIds` in one multicall.

---

### Also noted (lower severity)
- `attest()` can overwrite `attestedRisk[mrvHash]` at any time; no expiry, no nonce, no `deadline`, and the `Attested` event **omits the verifier address**, so score attribution is unauditable.
- `transfer()` permits `to = address(0)` → credits permanently locked with no retirement record; no ERC-1155 compatibility, so no approvals, indexers, or marketplaces.
- Unbounded `string` params stored or emitted (`cnCode` is stored; `registry`, `serial`, `beneficiary`, `reason`, `reportURI` are event-only) → storage/calldata griefing. Cap lengths.
- `CBAMAttestation.maxRiskScore` has no setter (fixed at 40 forever); `revoke()` allows repeated calls and blocks any re-attestation of the same commitment, so a corrected re-submission is impossible.
- `vintage` is unvalidated (`uint16`, accepts 0 or 65535); `year`/`quarter` in CBAM check quarter but not year.
- `attest()` accepts an arbitrary `reportURI` with no content-addressing or retrievability requirement — the report need not exist.
- `ORACLE_BLINDING_KEY` from env is passed through `Buffer.from(x, "hex")` without validation; a non-hex value silently yields a short/empty HMAC key.
- `errMsg` returns HTTP 200 with `{ok:false}` — clients and monitors cannot distinguish success from revert.
- `fs.mkdirSync(..., {mode:0o700})` on `.secrets` is good, but the directory is created only if the file is missing; pre-existing dirs keep their mode.

---

## Threat-Model Notes

**Oracle trust.** The trust anchor is one EOA that is simultaneously admin, verifier, and issuer, fronted by an unauthenticated HTTP server. There is no quorum, no staking or slashing, no challenge/dispute window, no second independent verifier, and no bond that can be forfeited on a bad attestation. `reportURI` is a free-form string with no content addressing, so the "evidence" behind a score need not exist or be retrievable. The satellite input is a third-party reanalysis product (NASA POWER GHI) fetched live with a 20s timeout, no retry, no signature, and a silent fail-open path — a network failure or a crafted date range removes the strongest physical check at zero cost. Off-chain, the blinding key sits in `.secrets/oracle_blinding_key` (0600) or an env var, in the same process that serves public HTTP traffic; a single file read or env leak compromises every historical commitment. **Net: the protocol's security equals the security of one Node process.** For a production claim, this needs threshold signatures (2-of-3 independent verifiers), on-chain dispute with a slashable bond, and attested/hashed evidence bundles.

**Replay.** No attestation carries a nonce, deadline, chain ID, or issuer binding (the Registry omits `chainid` entirely; CBAM includes it). A valid attestation is reusable until `usedMrv` blocks *that exact hash* at issuance — but since the hash covers neither amount nor project, the approval transfers freely across terms (finding 2). `attest()` can be re-called to overwrite a score, so a previously blocked MRV can be re-attested as clean by the same key. Cross-chain replay is open on the Registry: the same `(registry, serial, mrvHash)` can be issued on a forked or sibling deployment, and both chains will report the credit as unique. Front-running: a mempool observer can copy a pending `issue` calldata; the second call reverts on `usedSerial`, which is a griefing nuisance rather than theft, but it does let an attacker burn an issuer's gas and pre-empt the serial.

**Double counting.** `usedSerial` + `usedMrv` prevent re-issuing byte-identical data under byte-identical labels. They do not prevent: (a) the same project under two registry names or two serial namespaces; (b) the same dataset with one reading perturbed; (c) the same project split into arbitrarily many sub-batches (legit per-batch, but no aggregate cap against the project's total reduction); (d) the same reduction issued on two chains; (e) the same retired tonne claimed by two beneficiaries, because `beneficiary` is an unvalidated free string and there is no on-chain claim registry keyed by beneficiary. Crucially, the carbon-market meaning of double counting — a corresponding adjustment under Article 6, host-country authorization, and non-claiming against the host NDC — is **not modelled at all**. The contract solves serial-hash dedupe, which is the narrowest possible reading of the problem, and it does so on exact float equality, which is the weakest possible key.

**Privacy of hashes.** `mrvHash` is `HMAC-SHA256(globalKey, canonical(data))`: deterministic (so duplicates are caught, by design) and global (so identical readings at two sites collide, and one key compromise forks every hash). It is not a commitment — a third party cannot open it, so it proves nothing externally; it is an oracle-internal dedupe tag with privacy properties that depend entirely on key secrecy. It is explicitly **not** zero-knowledge, despite the "zk-ready" comment. On the CBAM side the commitment is unkeyed `sha256(salt || data)` and sits next to plaintext `tonnesProduct`, `embeddedKgCO2PerT`, `cnCode`, and a hash of an enumerable `IEC/EORI`; the salt is handed to the client in the API response and never persisted. The realistic privacy posture is: exporter identity is pseudonymous-but-reversible, emissions intensity is public, and the only secret is a salt that the system does not keep. Any claim of confidentiality in a pitch should be withdrawn or narrowed to "raw meter time series stay off-chain."

---

## Limitations a Hackathon Judge Would Raise

1. **It does not run as delivered.** No `package.json`, no `hardhat.config.js`, no `public/`, no `data/`, no `deployments/`, no tests. `server.js` is documented as `npx hardhat run scripts/server.js` but is a long-running Express server, which is an odd fit for a Hardhat script; `ethers.getSigners()` on `--network sepolia` requires keys wired into a config that is absent. There is no README, no deploy script, no CI.
2. **Zero tests.** No unit tests, no fuzz/invariant tests, no coverage, no gas report. For contracts whose headline claim is "cannot be double counted," the absence of an invariant test on total retired ≤ total issued is the first thing a reviewer checks.
3. **The "AI" is a hand-weighted scorecard.** Deterministic thresholds, arbitrary additive weights (35/30/20/25/40), an unjustified PASS cutoff of 40, no training data, no validation set, no precision/recall, no calibration, no model versioning, no provenance. It cannot be audited or improved empirically, and the weights are visible to an adversary, who can tune inputs to stay just under each threshold.
4. **Emission factors and benchmarks are invented.** `EF` and `ROUTES` are explicitly "illustrative defaults"; the real CBAM default values, the actual CN code list, and the certificate-surrender workflow are absent. `Assess` covers only CN 72/76.
5. **"Definitive period 2026" is asserted, not implemented.** No CBAM declarant (importer) workflow, no registry integration, no certificate accounting, no linkage between a CBAM attestation and any credit registry — the two contracts are entirely independent, which undercuts the "one platform" story.
6. **Satellite model is crude.** NASA POWER GHI is reanalysis at ~0.5°, not measurement; daily GHI × capacity × a fixed PR ignores temperature derating, soiling, clipping, tilt/azimuth, inverter limits, and curtailment. `PR_TYPICAL = 0.78` and the r < 0.5 correlation cutoff are unjustified constants. A real PV plant can legitimately fall outside these bounds, so false positives are likely at scale.
7. **Not zero-knowledge.** No SNARK/STARK, no range proof, no selective disclosure. "zk-ready" is a comment, not a property; the commitment is a salted hash that requires full disclosure to verify.
8. **No governance or ops story.** No pause, no upgrade path, no key-rotation, no incident response, no monitoring, no disclosure policy. `setVerifier` and `setIssuer` take effect instantly with no timelock.
9. **No economic or legal model.** No price, no escrow, no buyer protection, no insurance, no registry MoU, no Article 6 corresponding-adjustment path, no data-protection analysis (GDPR vs. on-chain immutability is unaddressed).
10. **Demo-shaped UX boundary.** Everything funnels through one Express process holding the key; the on-chain "verification" functions are decorative (finding 5), and `/api/retire` lets any visitor burn the operator's credits. A judge clicking around will find this in under a minute.

---

*Review only — no files were modified other than creating this document.*
