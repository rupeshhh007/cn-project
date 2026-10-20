# HOPNET Resilience Studio checkpoint — 2026-10-20

## Current branch and preservation

Development branch: `codex/hopnet-resilience-studio`, from confirmed remote `feat/hopnet-lan` at `1683052`. UI checkpoint `82b7a2a` and Sentinel are preserved. PR #1 was confirmed OPEN, fetched and integrated through its repair branch ending `8b8b020`; no merge into main occurred. Gate 1 implementation checkpoint: `bca9707`; Studio/protocol checkpoint: `3e830a1`; credential-log privacy checkpoint: `73c278b`; final visual checkpoint: `41110f8`. Final source verification passed before the visual/evidence commits. The branch is pushed for review against `feat/hopnet-lan`, never `main`.

## Current implementation

Bounded two-route RTC transfer scheduling, measured/backed-off ACK deadlines, per-path receiver confirmation, alternate-path recovery, idempotent lost-completion recovery, serialized receiver hashing, cancellation and terminal-state guards are implemented. Ephemeral ECDSA keys authenticate file envelopes and receipts. The coordinator requires open-channel reports from both endpoints and invalidates observations when permissions are removed. Old connection callbacks cannot overwrite a replacement.

Send now has session conversations and file results. Lab provides A/B/C presets, actual path prerequisites, three strategies, custom/repeatable payloads, host-only logical fault injection, local metrics and JSON/CSV export. Replay freezes actual local journal snapshots with scrub, step, playback, speed and export; it sends no packets. Route geometry uses measured canvas dimensions and plinth perimeter anchors.

Visual refinement uses self-hosted OFL Instrument Sans, a text-free generated silk atmosphere, new alpha laptop/phone renders, a light frosted inspector and spring-driven navigation. Original assets are preserved. Centering and tablet scaling are independent; selection lifts only hardware, not route anchors. Decorative cutout padding cannot intercept peer clicks. Replay coordinates share the historical node coordinate space. Space keeps active/latest file status while Send retains the full bounded transfer history. Prompts, source/licensing decisions and reference comparisons are in `design/REFINEMENT.md` and `VISUAL_QA.md`.

## Verification and evidence

The implementation passed `npm run check` (38 unit/integration tests and production build), all six Chrome browser flows and `npm audit --audit-level=high` (zero findings). The expanded gate passed five real browser peers, Lab's logical fault button, parsed JSON/CSV export, seven viewport walkthroughs (including the native 1586×992 concept size), and the production no-progress deadline after loss of the only relay. Stable screenshots wait for fully opaque transfer cards and disable capture-time CSS transitions.

Raw evidence lives in `docs/evidence/automated-relay-recovery.json`, `automated-lab-trial.json` and `automated-lab-logical-recovery.json`. Browser recovery uses an actual closed relay context, 8 MiB/256 chunks and an independently hashed download. Screenshots from passing flows are in `docs/screenshots/studio/`, `hopnet-resilience-active.png`, `hopnet-resilience-recovered.png`, and `hopnet-no-alternate-failure.png`. Public invitation QR captures are masked. The final sequential `npm run check` plus six-flow E2E gate passed on 20 October (E2E: 3.8 minutes); timings are test execution duration, not a network benchmark.

Continuous trace snapshots caused excessive observer overhead, including an observed 18.8-second UI click in a trace; the E2E flows retain explicit assertions, structured evidence and screenshots with tracing disabled. Protocol timeouts were not extended. The no-alternate test's overall harness budget is 120 seconds to include setup, the production 60-second no-progress deadline, screenshot and cleanup; its failure-state assertion remains capped at 65 seconds. E2E runs the production app. Iteration also included an interrupted sleep/wake run, resource-sensitive capture deadlines, and genuine overlap/alignment regressions; these were not treated as passes. Final source verification is distinct from pending physical acceptance.

## Physical and research handoff

**Physical acceptance is pending.** No five-device, Safari, Android, mobile keyboard or physical Wi-Fi recovery result is claimed. Doctor discovered `en0`, `172.17.96.201` on 2026-10-20; re-run it if the address changes. Exact trusted-HTTPS commands, diamond links, metric definitions, demo script and evidence requirements are in `RESILIENCE_STUDIO.md` and `DEVICE_TESTING.md`. The implementation-backed paper is `RESEARCH_DRAFT.md`; no physical performance improvement or statistical superiority is asserted.

Known limitations: loss/queue strategy inputs use conservative defaults, not measured live telemetry; payload encryption is hop-by-hop; conversations clear on reload; chat receipts lack file endpoint signatures; replay cannot recover evicted/remote history; completed downloads have bounded retention; Vite reports a non-fatal bundle-size warning. Human visual acceptance against the original references remains pending.

---

# Archived checkpoint before Resilience Studio

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
