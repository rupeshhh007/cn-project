# HOPNET CN Studio — distributed-routing checkpoint

## Implemented

- Stabilization from `19531dc`: signed offer-preparation/capacity declines; cancellation succeeds locally after route loss and releases resources; bounded message ACK tracking/retry with receiver deduplication, terminal failure and late-ACK rejection. No redesign.

- Independent browser hello liveness, sequenced/aged LSA flooding, LSDB and local SPF/forwarding tables.
- Hop-by-hop messages and independently routed receiver ACKs; trace/TTL/duplicate safeguards.
- Dedicated Routing inspectors, before/after table episodes, observer-local reachable-component agreement and JSON/CSV exports.
- Real control/data event pulses, Replay filters and recorded router state; saved-link restoration after logical relay faults.
- Existing signed multipath file recovery preserved and now selects paths from the local LSA-derived graph.
- Eight-admitted-session room bound matches the protocol limits. Existing UI assets/typography and earlier feature work are preserved.

## Verified

- `npm run check`: 56 tests, TypeScript and production build pass.
- `npm run test:e2e -- --workers=1`: eight Chrome flows pass, including actual **mid-message** stalled-relay closure and exactly-one logical receiver delivery/accepted ACK, selected-relay closure, signed file recovery, no-alternate failure, Lab/Replay interactions and six required responsive sizes.
- `npm audit --audit-level=high`: zero findings.
- Actual screenshots and raw before/after router/file evidence are committed under `docs/`.

Earlier failed/loaded runs and the corrections are documented in `docs/CN_STUDIO.md`; no timeout or physical result is fabricated. The production no-progress deadline and the 60-second recovery verification assertion were not extended.

Current stabilization evidence, visual inspection and residual risks are recorded in `docs/STABILIZATION_20261022.md`; raw mid-message failure evidence is `docs/evidence/message-midflight-recovery.json`. Remote notification remains best effort and chat receipts remain cooperative, not endpoint-signed.

## Deliberately not claimed complete

File envelopes remain signed **source routes**, not dynamic local-table chunk forwarding. Application delay injection, automated routing A–F orchestration/message-stream measurements and the full graphical shortest-path/convergence timeline remain follow-up work. Physical five-device acceptance and comparative benchmarks are pending. Control-plane/chat reporting is cooperative, not Byzantine-secure or equivalent to the endpoint-signed file protocol.

Detailed architecture, exact physical test instructions, metric definitions and remaining gates: `docs/CN_STUDIO.md`. Paper extension: `docs/CN_RESEARCH_DRAFT.md`. This draft PR targets `feat/hopnet-lan`, never main; it preserves the previous Resilience Studio history.
