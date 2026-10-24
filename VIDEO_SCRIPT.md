# Demo video script (target 3:30, max 5:00)

**0:00–0:30 Problem** (slide or voice-over). "Carbon credits are meant to fund real climate action. But investigations have found many credits are over-issued, and the same tonne can be sold twice. Buyers can't tell good credits from bad. CarbonGuard fixes trust with AI + blockchain." Track: Carbon Markets & Emissions Transparency.

**0:30–1:00 How it works.** Show the README architecture. "AI verifier scores MRV data → attests risk + data hash on-chain → smart contract issues only low-risk, never-seen-before data → retirement is permanent."

**1:00–1:45 Honest project.** Load the Jaipur Rooftop Solar data and show the chart. Click Run AI verification and point at 0/100 PASS and "Claim 8 t consistent with 9.0 t". Click Attest + Issue and show the tx log and the new row in the registry.

**1:45–2:30 Fraud project.** Load the inflated project. Point at the red bars above the "physical max" line. Run it and show 85/100 BLOCK with its three findings. Click Issue and show the revert `RiskTooHigh(85)`. "The contract itself refuses. No one can bypass the AI gate."

**2:30–3:00 Double counting.** Re-submit the honest project and show `DuplicateSerial`. "Even under a new serial, the same data hash is rejected."

**3:00–3:20 Retire.** Click Retire, enter Acme Corp, and show "fully retired".

**3:20–3:45 Impact and next steps.** Users are registries, developers, buyers, and policymakers. Next come IoT signatures, satellite data, and cross-registry hash sharing. Mention the 10 passing tests and the open-source repo. Close: "CarbonGuard: every tonne real, every tonne counted once."

Record with OBS or Loom at 1080p and upload to YouTube as Unlisted or Public.
