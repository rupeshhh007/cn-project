# HOPNET test plan

The visual release walkthrough also checks the concept's native 1586×992 dimensions, in addition to the six desktop/tablet/mobile acceptance sizes. It asserts local font loading, loaded device assets, asset-frame containment, enabled-control hit areas, live path endpoints on plinths and historical SVG endpoints on recorded node centers. Tracing is disabled to avoid continuous screencast overhead; explicit screenshots and structured protocol evidence are retained.

## Automated Phase 0

- Protocol rejects oversized relay messages and unknown versions.
- Untrusted display labels are sanitized.
- Room join requires the invitation secret.
- Admission requires host authorization.
- The approved requester can claim a scoped peer session.
- TypeScript strict checks and production web build pass.
- Playwright creates isolated 1440×900 and 390×844 browser contexts, admits the participant, waits for direct WebRTC, measures ping, exchanges a message, and captures screenshots.
- A three-browser test admits two participants into the default host-star, verifies the destination has no direct endpoint DataChannel, sends `A → host → B`, observes forwarding at the host, delivery at B, and the reverse receipt at A.
- Direct and three-browser relayed file-transfer tests require acceptance, verify chunk checksums, observe receiver acknowledgements, and mark completion only after the receiver reports a matching whole-file SHA-256 digest.
- Routing unit tests cover graph validation, deterministic BFS, no-route failures, disabled edges, latency choice, adaptive penalties, stale metrics, disjoint paths, and honest single-path fallback.

## Manual physical-device Phase 0 gate

See `DEVICE_TESTING.md`. Evidence required before marking physical connectivity complete:

1. Host screen with the real second device admitted.
2. Both peer inspectors showing `direct` and an actual candidate-pair description.
3. Direct ping event and measured RTT on the sender.
4. A message visible in the receiver event history.
5. Browser/OS versions, LAN type, and whether the origin used HTTP or trusted HTTPS.

No screenshot or automated localhost test substitutes for this gate.

## Resilience Studio acceptance

- `apps/web/test/` covers exact baseline selection, endpoint signature tampering, lost completion probes, duplicate/unbound ACKs, cancellation from both endpoints, cancellation while asynchronous hashing is suspended, receiver consent, insecure-origin rejection, bounded lack of receiver progress and honest export nulls.
- `tests/e2e/resilience.spec.ts` creates four isolated Chrome contexts, proves two receiver-acknowledged relay paths, closes an active relay browser, verifies completion, downloads the result and independently hashes it.
- `tests/e2e/no-alternate.spec.ts` uses actual RTC channels, closes the only relay and waits through the production no-progress deadline. It verifies an actionable failed result instead of extending the protocol timeout.
- `tests/e2e/studio.spec.ts` creates five actual browser peers, verifies the visible Send conversation and delivery receipt, exports/parses JSON and CSV, runs a real logical-fault Lab trial, and tests Space/Messages/Replay controls, hit testing and overflow at seven viewports, including the concept's native dimensions.
- Continuous trace snapshots are disabled to avoid observer overhead; recorded protocol data and actual screenshots are saved under `docs/evidence/` and `docs/screenshots/`.

The required automated commands are `npm run check`, `npm run test:e2e`, and `npm audit --audit-level=high`. A single-worker browser run is useful for reproducible timing. Parallel localhost browser timing is not a physical-device benchmark.

# Session/reliability gate — 22 October 2026

See `SESSION_RECOVERY_20261022.md` for A–O coverage, source-level root causes, per-tab capability/security semantics and failed-attempt disclosure. `tests/e2e/session-recovery.spec.ts` covers actual reload/RTC rebuild, authoritative host recovery, rejected/expired admission, clone rejection, signaling/data-plane separation, active-transfer interruption and repeated diamond restoration. The physical gate is `PHYSICAL_DEMO_GUIDE.md`; user-reported prior LAN observations are separate in `evidence/MANUAL_LAN_REPORTED.md`. Historical test descriptions above remain archived context, not new physical results.
