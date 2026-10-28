# Route Pulse — on-demand overlay diagnostics

Added 29 October 2026 on `codex/hopnet-cn-studio`, building on the already-pushed recovery checkpoint `19fcaf4`. This preserves Space, Routing, Send, Lab, Replay, existing typography/artwork and signed file transfer.

## Show it in the presentation

1. Admit real peers and establish permitted WebRTC links. On Space choose a peer and press **Route Pulse · trace this peer**, or open **Routing** directly. Mobile Messages also has **Open Route Pulse**.
2. Select **Destination** and press **Send route pulse**. A small diagnostic request follows each router's current next-hop table. The receiver returns its observed outward trail through independently selected return hops.
3. Only a matching receiver receipt produces **Receipt returned**, outward hop count, actual device trail, return trail and sender-local round-trip time. The UI retains six recent pulse results across destinations; **Export pulses** exports those retained for the selected destination. These are historical observations, not a guarantee the route is still alive.
4. In a diamond, record a pulse, then use Lab to disconnect the relay actually named in that trail. Wait for the survivor route, return to Routing and pulse again. **Path changed** appears only when the new successful outward trail differs from the preceding retained successful trail for that destination.

The orb breathes only while a manually requested receipt is pending; device artwork fades in after the receipt. These are feedback transitions, **not animations measuring packet transit**. Reduced-motion preferences disable both. No scheduled probe loop, new library, generated bitmap or remote asset is added.

## Protocol and bounds

`router-data` gains `probe`/`probe-ack` purposes and an optional bounded `probePath`. The existing authorized RTC ingress, endpoint generations, trace/TTL loop checks and packet duplicate cache apply. A probe has an empty body, UUID correlation ID and attempted sequence. The receiver echoes the observed outward trail, not a coordinator-computed route. On return, the sender requires the pending ID/sequence, expected receiver, original first hop, valid unique room-peer trail and live deadline. Wrong, duplicate, old-generation, terminal and late receipts cannot complete a pulse or chat message.

There is **one pending probe per browser**, at least one second between launches, an eight-second sender-monotonic receipt deadline and an eight-router maximum trail. No retry is automatic. Receiver restart/dispose/send failure produce honest unconfirmed states. A missing return route is not reported as success merely because the outward request arrived. Probe events are classified as actual data-plane events in Replay, but probes never create conversation bubbles, chat ACKs or file verification results.

This is application-overlay diagnosis, **not IP/ICMP traceroute**. RTT includes both paths, browser scheduling and processing. It does not measure one-way or individual-hop latency. Hop reports are cooperative, **not ECDSA-signed file receipts or Byzantine-secure proofs**. Load the same updated build on every peer; older clients do not understand these diagnostic purposes and will not return a receipt.

## Verification and evidence provenance

Six deterministic protocol tests cover exact outward/return trails, no chat pollution, malformed/unmatched/late/duplicate receipt rejection, manual/rate/in-flight bounds, changed diamond branch, endpoint restart/dispose/send error, and an arrived request without a return route. `tests/e2e/route-pulse.spec.ts` uses four real Chrome/WebRTC browser contexts, obtains UI exports, faults the actual relay in the first reported path, observes a different returned path, and checks desktop/mobile, exports and no conversation pollution. These are logical browser routers on one host, not four physical devices.

During QA, the first 390×844 capture exposed a narrow text column beside the destination selector. The mobile header now wraps the selector and action onto full-width rows. Existing visual assets and font were not replaced. The Browser plugin was unavailable, so the existing Playwright workflow supplies browser interactions, console checks and screenshots under `/tmp/hopnet-route-pulse-*`. Final command results and public deployment verification are recorded in `DEPLOYMENT.md` and the current progress handoff. No benchmark numbers are invented.

The first full browser gate also caught the pulse button becoming usable during the protocol's one-second cooldown. It now displays a disabled **Ready in a moment…** state until the launch window opens; the protocol limit is unchanged. A recovery test was strengthened to wait for the confirmed **Waiting for host approval…** state before reloading instead of racing its initial asynchronous POST. Failed attempts are not counted as passes.

Recovery validation also exposed a localhost file completing before the test's reload could interrupt it. That test now uses Chrome's documented receiver CPU-throttling mechanism (8×), asserts nonzero **incomplete** receiver-ACK progress before reload, then removes throttling. It still uses native RTC, genuine bytes, hashing and signed receipts; this is an explicitly emulated processing slowdown, not a physical-phone performance result. A separate 15-second post-admission negotiation timeout was not reproducible in three consecutive diagnostic repeats; no unrelated RTC algorithm change is claimed to fix it. Redacted signaling lifecycle metadata is attached for future recurrence. Browser negotiation/suspension variability remains a physical-demo risk.

The Studio logical-fault trial had the same localhost race: its default file could finish before the fault button was pressed. It now selects the relay before starting, sends a real 16 MiB payload, temporarily slows receiver processing with the same explicit CPU emulation, asserts incomplete ACK progress on both paths, and requires a real `path-unavailable` event before removing throttling. Verified completion, recorded fault time and recovery progress remain mandatory; production protocol deadlines are unchanged. This is test scheduling control, not evidence of a measured physical-device speed or performance improvement.
