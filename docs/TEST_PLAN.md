# HOPNET test plan

## Automated Phase 0

- Protocol rejects oversized relay messages and unknown versions.
- Untrusted display labels are sanitized.
- Room join requires the invitation secret.
- Admission requires host authorization.
- The approved requester can claim a scoped peer session.
- TypeScript strict checks and production web build pass.
- Playwright creates isolated 1440×900 and 390×844 browser contexts, admits the participant, waits for direct WebRTC, measures ping, exchanges a message, and captures screenshots.
- A three-browser test admits two participants into the default host-star, verifies the destination has no direct endpoint DataChannel, sends `A → host → B`, observes forwarding at the host, delivery at B, and the reverse receipt at A.
- Routing unit tests cover graph validation, deterministic BFS, no-route failures, disabled edges, latency choice, adaptive penalties, stale metrics, disjoint paths, and honest single-path fallback.

## Manual physical-device Phase 0 gate

See `DEVICE_TESTING.md`. Evidence required before marking physical connectivity complete:

1. Host screen with the real second device admitted.
2. Both peer inspectors showing `direct` and an actual candidate-pair description.
3. Direct ping event and measured RTT on the sender.
4. A message visible in the receiver event history.
5. Browser/OS versions, LAN type, and whether the origin used HTTP or trusted HTTPS.

No screenshot or automated localhost test substitutes for this gate.
