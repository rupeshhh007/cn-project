# HOPNET continuity checkpoint

## Repository state

- Active branch: `feat/hopnet-lan`.
- Preserved Sentinel branch: `feature/sentinel-network-lab` at audit commit `0995516`.
- Premium spatial UI checkpoint `82b7a2a` was confirmed locally and pushed to `origin/feat/hopnet-lan` on 2026-10-19.

## Verified automatically

- Strict TypeScript checks pass for coordinator, web, protocol, routing, and transfer packages.
- 23 unit/integration tests pass, including LAN-origin allow-listing, admission authorization, packet bounds, transfer chunk and whole-file hashing, three routing strategies, and disjoint-path selection.
- Production Vite build passes.
- Three Playwright flows pass in Chrome: admitted two-browser direct WebRTC messaging/acknowledgement, three-browser application relay with a receiver receipt, and both direct and three-browser relayed accepted file transfers with receiver verified SHA-256 completion.
- The invitation regression verifies that the QR advertises a non-loopback coordinator interface even when Playwright opens the host at `127.0.0.1`.

## Physical status

**PENDING USER HARDWARE VERIFICATION.** No physical MacBook/phone result is claimed. Follow `docs/DEVICE_TESTING.md` and return the listed evidence before closing the LAN gate.

## Next ordered slice

Extend transfer recovery tests with two disjoint live data paths, missing-chunk injection, and relay disconnection; then complete the controlled laboratory, event replay, measurement export, reproducible paper, and five-device physical demonstration.
