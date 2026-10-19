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
- File chunks are 32 KiB with an eight-chunk in-flight ceiling, receiver acknowledgements, and re-selection from currently measured paths after missed acknowledgements. Direct and relayed browser transfers pass after this tuning.
- The invitation regression verifies that the QR advertises a non-loopback coordinator interface even when Playwright opens the host at `127.0.0.1`.

## Physical status

**PENDING USER HARDWARE VERIFICATION.** No physical MacBook/phone result is claimed. Follow `docs/DEVICE_TESTING.md` and return the listed evidence before closing the LAN gate.

## Next ordered slice

The next automated gate is a stable fault-injection E2E proving that a multipath transfer still reaches receiver-verified SHA-256 after a relay disconnect. An exploratory browser run showed relay degradation, retry events, and a receiver-verified result in captured browser state, but the test itself timed out; it does not count as a pass. Then complete the controlled laboratory, event replay, measurement export, reproducible paper, and five-device physical demonstration.
