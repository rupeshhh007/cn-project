# HOPNET milestones

- [x] Preserve `main` and `feature/sentinel-network-lab`; create `feat/hopnet-lan` from `main`.
- [x] Define product truth, architecture, v1 protocol and test gate.
- [x] Phase 0 automated checks pass, including a two-context Chrome RTCDataChannel test.
- [x] LAN invitations select a server-discovered physical origin, reject arbitrary QR origins, and expose a reproducible Network Doctor.
- [ ] Phase 0 physical two-device RTCDataChannel gate passes.
- [ ] Phase 1 five-device presence and messaging gate passes.
- [ ] Phase 2 enforced application-level multi-hop and reroute gate passes.
  - [x] Automated three-browser A → relay → B delivery and reverse receipt pass without an A–B channel.
  - [ ] Physical three-device forwarding and alternate-route failure recovery pass.
- [ ] Phase 3 accepted, verified direct and multi-hop file transfer gate passes.
- [x] Automated direct and multi-hop WebRTC file offers require receiver consent, verify chunk and whole-file SHA-256, and return a receiver-confirmed completion receipt.
- [ ] Phase 4 disjoint multipath and mid-transfer recovery gate passes.
- [ ] Phase 5 experiment/replay/export gate passes.
- [ ] Phase 6 desktop/mobile visual and accessibility acceptance passes.
- [ ] Phase 7 five-device live-demo acceptance passes.

## Resilience Studio automated checkpoint (2026-10-20)

- [x] Audit PR #1 as open and integrate its six repair commits into a dedicated development branch, preserving the feature and Sentinel branches.
- [x] Correct disjoint-route selection, including greedy-blocking and repeated-direct-edge regressions.
- [x] Four isolated browser contexts deliver an 8 MiB file over two relay paths, lose one relay browser, download and independently verify SHA-256.
- [x] Dedicated Send conversations, accepted transfers, signed endpoint receipts and cancellation.
- [x] Lab presets, actual path prerequisites, trial execution and parsed JSON/CSV exports.
- [x] Five-browser Lab trial survives the host's logical relay-link fault; loss of the only relay produces a real, bounded browser failure.
- [x] Historical event snapshots, scrub/step/playback/speed and journal export.
- [x] Automated layout/interaction walkthrough at 1920×1080, 1586×992 (native concept), 1440×900, 1280×720, 768×1024, 430×932 and 390×844.
- [x] Self-hosted licensed typography, generated matching device assets, stationary route anchors and pointer/geometry regressions verified against actual browser captures.
- [ ] Final five-device physical, Safari/Android, keyboard and visual acceptance against the original references.

Automated checks do not close any physical gate above. Final run details and acceptance gaps are recorded in `PROGRESS_HANDOFF.md`.
