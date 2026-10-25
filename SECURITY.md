# SECURITY.md — CarbonGuard+ threat model

## Assets
Carbon credit batches (CarbonCreditRegistry), CBAM attestations (CBAMAttestation), oracle/verifier key, MRV data.

## Threats and mitigations
| Threat | Mitigation |
|---|---|
| Inflated MRV claims | AI anomaly checks plus a NASA POWER satellite cross-check. The contract reverts with `RiskTooHigh` when risk > 40 |
| Double counting / resubmission | MRV fingerprint is unique on-chain (`DuplicateMRV`) and `DuplicateCommitment` blocks repeat CBAM attestations |
| Note/whitespace tweaks to bypass dedupe | The fingerprint ignores free-text fields and is computed over canonical readings |
| Leaking commercial data on a public chain | Only an HMAC-blinded fingerprint / salted sha256 commitment goes on-chain ("zk-ready": a ZK proof could later replace the reveal step; this is **not** a zero-knowledge proof today) |
| Unauthorised issuance | `onlyVerifier` on issue/attest/revoke |
| Tampered data shown to importers | The verify page recomputes the commitment from the disclosed data + salt and checks it against the chain |
| Key exposure | Keys live in `.secrets/` (gitignored, mode 600) or in env vars, and are never logged |

## Known limitations
- The single verifier/oracle key is a centralisation point. A production version should use multisig or a threshold-oracle setup.
- Satellite data (about 0.5° grid, daily) can't prove what one meter read. It only bounds what is physically plausible.
- The CBAM emission factors are illustrative, not the official EU default values.
- Demo datasets are simulated from real NASA irradiance data.
- No external audit has been done, and the contracts are not upgradeable.

Report issues privately to the maintainers. Please do not open public issues for vulnerabilities.

## v2 fixes (Oct 25, 2026)
- Separate keys: the registry constructor takes `(verifier, issuer)`, and the admin is neither. CBAM takes `(verifier)`. Tests cover this.
- Attestations are bound to `keccak(chainid, contract, mrvHash, projectId, amount, vintage)` and can't be overwritten (`AlreadyAttested`).
- `abi.encode` replaces `abi.encodePacked` in the serial and batch keys.
- The public API has a per-IP rate limit (`RATE_LIMIT_PER_MIN`), an optional `API_KEY` for write endpoints and an optional `READ_ONLY=1`. The JSON body limit is 200 kb, and lat/lon are validated before the NASA cache path is built.
- Scoring fails closed: missing satellite data adds +15 risk, and malformed readings add +40.
- Still open: fuzzy or cross-registry dedupe (#3), the CBAM verify semantics (#5), privacy of low-entropy fields (#6), a multisig admin and EIP-712.
