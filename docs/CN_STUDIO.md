# HOPNET CN Studio — distributed routing checkpoint

Stabilization follow-up: see `STABILIZATION_20261022.md` for signed preparation declines, local-first cancellation, bounded message retries and late-ACK/deduplication guarantees. The architectural scope below is unchanged.

## Scope and preservation

Branch: `codex/hopnet-cn-studio`, based on the existing Resilience Studio work at `1c6c99d`. Sentinel, UI commit `82b7a2a`, `feat/hopnet-lan`, and the previous review branch are preserved. No merge into main is authorized or performed.

This checkpoint implements the distributed messaging/control-plane slice and exposes it in Routing and Replay. It is not a claim that every item in the CN Studio rebuild specification is complete.

| Gate | Implemented in this checkpoint | Remaining |
| --- | --- | --- |
| 1 | Real RTC hello liveness, LSA flood/expiry, local LSDB/SPF, forwarding tables, hop-by-hop messages/ACKs | Broader physical validation and adversarial control-plane authentication |
| 2 | Dedicated Routing navigation; per-browser neighbors, LSDB, counters, destination branches and table export | Full graphical shortest-path tree with all branches simultaneously |
| 3 | Before/after table episode, quiet-window stability, reachable-component report agreement, actual closed-relay browser recovery | Dedicated convergence timeline panel and controlled message-stream experiments |
| 4 | File paths/recovery now read the local LSA-derived graph; existing signed multipath, consent, chunk ACKs and SHA-256 retained | File envelopes remain source-routed, not rewritten by each relay's forwarding table |
| 5 | Existing transfer trials/fault controls plus saved-link restoration; Replay filters, recorded router snapshots and actual-hop pulses | New A–F routing-specific trial orchestration, application delay injection, message-stream success statistics |
| 6 | Existing premium assets/typography retained; Routing responsive screenshots and raw router evidence | Physical five-device runs and comparative statistical evaluation |

## Protocol architecture

`DistributedRouter` is instantiated independently in each browser. Its only transport is the existing authorized RTCDataChannel manager. The coordinator still authorizes membership/permitted edges and performs signaling; its globally observed graph is **not** the routing algorithm's topology input.

1. An open channel starts probing. A hello exchange activates its neighbor.
2. Every router originates an LSA listing its own active neighbors and hello RTTs.
3. Routers accept newer admitted-origin sequences, preserve a high-water mark after expiry, and flood with bounded TTL. Duplicate LSAs are suppressed.
4. The local graph requires mutually advertised edges. An inactive directly attached neighbor cannot remain a usable local edge.
5. Each browser computes minimum-hop, latency-aware or adaptive next hops using that graph. A local strategy change does not silently change other browsers' policies.
6. A message carries source/destination, packet/message IDs, sequence, TTL and an observed trace. Each intermediate browser chooses its own next hop. Repeated trace nodes, duplicate packets, exhausted TTL and unavailable routes are explicit failures.
7. The receiver generates an ACK routed independently through its own table. Sender delivery status changes only after that ACK arrives.

The schema bounds rooms/paths to the existing small classroom scale. Hello interval: 1 s; dead interval: 4.5 s; LSA refresh: 6 s; maximum age: 18 s; observations: every 3 s; duplicate data cache: 4,096 entries with 60 s retention. Immediate channel-close callbacks can detect a failure sooner than the hello deadline. Browser suspension can postpone timers: these are application deadlines, not real-time guarantees.

## What the visible evidence means

Routing's local state is read directly from this browser. Remote inspector snapshots are received through RTC-flooded, schema-validated reports; they never feed SPF. A remote table is an observation from another browser, not a centrally synthesized table. Its arrival age uses the observer's clock; internal remote times remain on the remote monotonic clock.

Local stability means no graph-driven recomputation for 1 second. Reachable-component agreement additionally requires fresh matching graph digests from every currently reachable destination. The displayed window runs from this observer's first graph change in that episode through agreement. It includes quiet/report scheduling and is **not** synchronized global convergence time. Unreachable peers are excluded explicitly. Isolated self-agreement is not evidence of whole-room convergence.

Control-byte TX counts serialized UTF-8 application control messages sent, including observation reports. It excludes SCTP/DTLS/IP overhead, retransmissions below the application, and file bytes. LSA originated/RX and recomputation counters are cumulative for the current browser session. Delivery counters include data ACK envelopes. RTT is a hello/ACK application round trip, not physical link latency.

Replay stores bounded local event snapshots including that router's LSDB, table and convergence state. `routerId` identifies the observer; `controlOrigin` identifies the advertisement origin when relevant. Control/data filters and hop pulses use actual recorded events. Playback sends no packets and does not invent observations for missing routers. Recorded full traces are observed traversals; a sender's planned path is not labeled as a completed traversal.

Router-generated events capture current router state. High-rate file/application events share the latest immutable router observation (normally updated within 500 ms); its `observedAt` is retained rather than pretending each chunk triggered a fresh topology sample. This bounds allocation/observer overhead without discarding packet events. Deploy this checkpoint into a fresh room and reload all participating browsers; old bundles do not speak the new control plane.

## Trust and limitations

This is a cooperative, application-layer link-state overlay, not OSPF, IP routing, kernel routing or router hardware. An admitted malicious router can lie about LSAs, reports, or chat ACKs. Control-plane authenticity/Byzantine agreement is not implemented. Existing endpoint-signed **file** receipts are retained; they must not be confused with unsigned chat ACKs. Transport encryption is hop-by-hop; relays can inspect payloads.

File route selection now uses LSA-learned topology, but signed file envelopes retain explicit source paths. A relay validates and advances that signed envelope; recovery reschedules unconfirmed chunks onto a newly available LSA-learned path. It does not modify an existing signed route. This is the explicitly permitted gradual integration, not completed dynamic file forwarding.

Adaptive loss/queue inputs remain conservative defaults, not live measurements. Latency policy uses measured hello RTT; no speedup or superiority is claimed. Routing reports increase observer overhead. History and restoration snapshots are session-local; reload loses them. Restore recreates saved permitted links and waits for genuine channel negotiation/hellos, never marks them connected artificially.

## Automated reproduction

Final checkpoint verification on 21 October 2026: `npm run check` passed (46 unit/integration tests, TypeScript and production build); the final sequential seven-flow Chrome suite passed in 4.7 minutes; `npm audit --audit-level=high` reported zero vulnerabilities. Vite retains its non-fatal bundle-size warning. Execution duration is not a network benchmark.

Earlier reruns are not represented as passes: five-second startup assumptions and a transient three-event ribbon assertion failed; one loaded run timed out while file progress continued. The harness now waits for two actual LSA-learned paths before the multipath offer, checks durable journal receipts, and separately bounds setup. The recovery assertion remains 60 seconds and the production no-progress deadline remains unchanged. An isolated recovery run and then the complete final suite passed. File event snapshots now reuse immutable routing observations to avoid unnecessary LSDB cloning per chunk.

```sh
npm ci
npm run check
npm run test:e2e -- --workers=1
npm audit --audit-level=high
```

The new `distributed-routing.spec.ts` creates four actual Chrome browser contexts and a diamond. All four local LSDBs/tables are collected through the public export UI. The test resolves which relay is the source's actual next hop, closes that browser, verifies the alternate table entry, sends a message, checks the receiver's conversation and sender ACK, and exports before/after state. This is genuine browser WebRTC execution on **one physical host**, not a four-device LAN benchmark.

Raw observations: `evidence/distributed-routing.json`. Before/after and six requested viewport screenshots: `screenshots/hopnet-four-router-lsdb.png`, `hopnet-distributed-routing.png`, and `hopnet-routing-WIDTHxHEIGHT.png`. Existing recovery/no-alternate tests still exercise file bytes and independently hash the downloaded result. Test artifacts change each run; do not quote an old timing as a universal benchmark.

## Five-device demonstration / evidence needed

1. Follow `DEVICE_TESTING.md` for **trusted LAN HTTPS** on all devices. Loopback automated crypto behavior does not prove Android LAN certificate trust. Keep phone browsers foregrounded and screens awake. Do not bypass security warnings and call that secure acceptance.
2. Name the two Macs Source and Destination; name two phones Relay One/Two and keep the third phone as Observer (or attach it as another relay). Admit all five through the real invitation.
3. In Lab select Destination. Disable Source–Destination; enable Source–Relay One–Destination and Source–Relay Two–Destination. Remove other shortcuts for a clean diamond; Observer may attach to Source.
4. Open Routing on each device. Wait for hello-active neighbors, matching LSDB edges, next hops and fresh overlay reports. Export router evidence and forwarding CSV **before** failure. Capture device names, browser versions and timestamped screen video.
5. Send a unique message. Show actual packet-forward/delivery/ACK events in Replay on the intermediate router and endpoints. Export journals from those devices; clocks are not synchronized.
6. Close the selected relay's browser, or separately use Lab's labeled logical fault button. These are different conditions; record which occurred. Wait for a new next hop, then send another unique message and record sender ACK. Export after-state and convergence observations. Logical failures can use Restore relay links; a closed browser must rejoin.
7. Send a consented file over two established relay paths. Verify ACK progress on both, fail one relay, wait for verified completion, save the file, independently compare `shasum -a 256` at both endpoints, and export transfer evidence. Label this source-routed file recovery.
8. Remove the only surviving route. Show an absent forwarding entry and disabled/unconfirmed delivery, not fake rerouting. Restore real links and re-check hellos.
9. For a paper comparison, repeat identical topology/payload/failure conditions under each policy, save every raw run including failures, and collect multiple independent physical trials. Do not derive statistical improvements from one-host functional tests.

Physical acceptance remains pending until those observations are supplied. The user has reported basic Mac/Android connectivity success, but no five-device distributed-routing or file-integrity physical acceptance is inferred from that report.
