# HOPNET continuity checkpoint

## Repository state

- Active branch: `feat/hopnet-lan`.
- Preserved Sentinel branch: `feature/sentinel-network-lab` at audit commit `0995516`.
- Premium spatial UI checkpoint `82b7a2a` was confirmed locally and pushed to `origin/feat/hopnet-lan` on 2026-10-19.

## Verified automatically

- Strict TypeScript checks pass for coordinator, web, protocol, and routing packages.
- 18 unit/integration tests pass, including LAN-origin allow-listing, admission authorization, protocol validation, three routing strategies, and disjoint-path selection.
- Production Vite build passes.
- Two Playwright flows pass in Chrome: admitted two-browser direct WebRTC messaging/acknowledgement and three-browser application relay with a receiver receipt.
- The invitation regression verifies that the QR advertises a non-loopback coordinator interface even when Playwright opens the host at `127.0.0.1`.

## Physical status

**PENDING USER HARDWARE VERIFICATION.** No physical MacBook/phone result is claimed. Follow `docs/DEVICE_TESTING.md` and return the listed evidence before closing the LAN gate.

## Next ordered slice

Implement the transfer protocol while preserving the passing onboarding gate: offer/accept/decline, manifest limits, ordered chunk framing, backpressure, per-chunk and whole-file SHA-256 verification, receiver acknowledgement, then multi-hop forwarding. After the single-path transfer is proven automatically, add two disjoint paths, missing-chunk recovery, relay-failure rerouting, event replay, measurement export, and the controlled laboratory.
