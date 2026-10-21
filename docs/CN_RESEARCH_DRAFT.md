# Design and Evaluation of a Browser-Based Distributed Overlay Routing and Failure Recovery System

Implementation-backed extension draft · 21 October 2026. Read alongside `RESEARCH_DRAFT.md`, which documents the signed multipath file subsystem. This document does not replace its trust model with stronger unsupported claims.

## Abstract

HOPNET CN Studio turns admitted WebRTC browser peers into observable application-layer routers. Each peer discovers live neighbors through hello exchanges, floods sequenced link-state advertisements, maintains a local link-state database and computes its own next-hop forwarding table. Messages and application acknowledgements are forwarded using those independent local tables. Per-router inspectors and a recorded protocol timeline expose neighbor liveness, advertisements, topology changes, forwarding and reachable-component agreement. A four-context automated Chrome experiment verifies topology dissemination and acknowledged message delivery after the selected relay browser closes. Existing consented, signed, integrity-verified file transfers now select source routes from locally learned topology, but their relays do not yet use dynamic per-hop forwarding. Automated results establish functional behavior on one host; physical LAN performance, comparative policy advantages and statistically significant improvements remain unevaluated.

## 1. Research question and contribution

Can a small, browser-only overlay implement and visibly explain distributed topology learning, local forwarding and recovery while preserving independently verifiable endpoint delivery? The contribution is an integrated, inspectable teaching/research instrument—not a new shortest-path algorithm, OSPF implementation or replacement for IP routing.

## 2. Model

The coordinator authorizes at most eight admitted sessions, distributes SDP/ICE and permits logical edges. An edge becomes a routing neighbor only after a real DataChannel and hello exchange. The graph used by a browser is derived from mutually consistent advertisements in that browser's LSDB, not the coordinator's global observed-link list. The host can remove/restore logical permissions; a separate experiment closes an actual browser participant. Neither operation modifies the Wi-Fi radio.

Control packets contain version, kind, origin, sequence, age and TTL. LSAs additionally carry bounded neighbor/RTT lists. Newer sequence numbers replace older records; duplicate flooding is suppressed and expired records do not resurrect through stale sequence replay. Each peer periodically refreshes its own advertisement. The implementation uses the same reliable ordered RTC transport as the application, so control traffic shares scheduling and queueing effects with application traffic.

## 3. Forwarding and policies

Minimum-hop routes use BFS; latency routes use weighted shortest paths over hello/ACK RTT. The existing adaptive cost also contains conservative default loss/queue penalties; these are not presented as sampled network telemetry. Policy changes are local to the selected browser. A comparison must configure and record the policies of every participating router rather than assume a global setting.

Message envelopes contain endpoint IDs, packet/message IDs, sequence, TTL and an observed trace. An intermediate browser consults its own next-hop table; it does not obey an end-to-end route carried by the source. It suppresses duplicate IDs and rejects repeated trace nodes, invalid ingress, exhausted budgets and unavailable next hops. The receiver returns an independently routed application ACK. These cooperative chat ACKs are not cryptographically equivalent to signed file receipts.

## 4. Failure and convergence measurements

An explicit channel-close callback withdraws a neighbor immediately; missing hello exchanges withdraw it after the local dead interval. New LSAs propagate the changed neighbor sets. Every observer records its own recomputation episode with before/after tables. A one-second quiet period measures local stability. Fresh matching graph reports from all reachable peers additionally establish observer-local reachable-component agreement.

That agreement window includes control/report scheduling. It excludes unreachable routers and is not a synchronized global convergence measurement. Remote monotonic timestamps must not be subtracted from local timestamps. Partition evidence consists of absent forwarding entries and failed/unconfirmed delivery, not an invented successful alternate path.

## 5. Functional experiment

The automated four-context experiment establishes a diamond with two relays and no direct source–destination DataChannel. Through the visible export UI, it verifies four LSDB origins and three forwarding destinations at each router. It reads the actual source next hop, closes that relay's browser context, verifies a different surviving two-hop route, sends a unique message and checks the destination conversation plus source ACK. The exported raw records retain all router-local snapshots and clearly identify one-host automated provenance.

Existing file experiments send real bytes across two relay routes, require receiver acceptance, close a participating relay mid-transfer, wait for receiver-verified completion, download and independently hash the result. Source-route envelopes are retained because their immutable paths are bound by endpoint signatures. Recovery reselects a newly available LSA-derived source path; it is not yet forwarding-table-based chunk routing.

Evidence: `evidence/distributed-routing.json`, existing signed-transfer evidence in `evidence/automated-relay-recovery.json`, executable tests and actual browser screenshots. Changing per-run timings must be extracted from those files, never replaced by illustrative values. Passing tests are functional evidence, not comparative performance benchmarks.

## 6. Physical methodology

Use two MacBooks and three foregrounded phones on one LAN with trusted HTTPS. Record device/browser/OS versions, topology, policies and fault type. Export router tables and journals before and after each failure; independently hash transferred files. Compare minimum hops and latency policy under the same physical topology and payload, randomize condition order, retain failed trials, repeat independently, and report distributions and uncertainty rather than a single best run. Collect a no-alternate-path condition as a negative control. Follow the exact steps in `CN_STUDIO.md` and certificate guidance in `DEVICE_TESTING.md`.

Candidate metrics are local agreement window, LSA RX/origination counts, serialized control-byte TX, recomputation counts, observed message ACK success/deadlines, per-router forwarded counts, receiver-confirmed file bytes, retry counts and recovery ACK gap. Counters are application observations; they exclude lower-layer wire overhead. Whole-network control cost requires collection from each device, without double-counting reports as advertisements.

## 7. Limitations and remaining work

All current automated peers share one host. Browser timers, CPU load, rendering and trace recording affect timing. Cooperative admitted routers can lie about LSAs, reports or chat ACKs; Byzantine security and signed control-plane flooding are not implemented. No global clock or merged omniscient journal exists. Routing views are remote reports when not inspecting the local browser. Stored history is bounded and session-local. Dynamic forwarding-table file chunks, application delay injection, automated message-stream experiments and dedicated A–F routing trial orchestration remain incomplete. The system must not be described as implementing these unfinished features.

The defensible current claim is functional distributed application-layer topology learning and acknowledged message rerouting, combined with an existing separately secured source-routed file-recovery subsystem. Physical five-device acceptance and any claimed comparative improvement require new evidence.
