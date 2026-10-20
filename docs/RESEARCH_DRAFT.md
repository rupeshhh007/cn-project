# Experimental Evaluation of Failure-Resilient Multipath File Delivery in Browser-Based Local Peer Networks

**Implementation-backed working paper · 20 October 2026**

## Abstract

HOPNET is a browser-based communication overlay that exposes the relationship between permitted topology, established WebRTC channels, routed file chunks and receiver verification. Its coordinator admits participants and distributes signaling and session identities; ordinary file payloads traverse peer DataChannels, including intermediate browser relays. The sender distributes a bounded window of chunks across internally node-disjoint routes and reschedules unconfirmed chunks when a route loses an established edge. Receiver consent, per-chunk SHA-256, whole-file reconstruction and endpoint-signed receipts constrain the meaning of successful delivery. A local experiment workspace and historical protocol journal make observations exportable and inspectable. Automated Chrome experiments demonstrate accepted direct and relayed transfers and completion after closing an active relay browser. These results establish functional feasibility on one host; they do not establish cross-device throughput improvements or physical Wi-Fi resilience. Five-device physical evaluation remains pending.

## 1. Problem and contribution

A browser may remain connected to a signaling service while its peer data path is unavailable. Similarly, an application can draw two graph routes without having two usable DataChannel paths. A useful educational networking system must make those distinctions explicit and must verify that the destination reconstructed the intended file after a failure.

The contribution is an observable experimental system combining browser forwarding, bounded multipath scheduling, receiver-confirmed recovery and event-based explanation. WebRTC, hashing, graph search and multipath communication are established techniques; this work makes no claim to invent them. The design question is whether a local-first browser implementation can execute and explain reproducible failure-recovery trials with independently inspectable evidence.

## 2. Architecture and trust

The coordinator maintains room membership, admission, permitted undirected edges, endpoint link reports and ephemeral verification-key bindings. It relays SDP/ICE signaling, never file payloads in the verified-transfer workflow. Explicit coordinator message fallback remains a separately labeled application action.

The data plane is a set of reliable ordered RTCDataChannels. Ordering applies separately to each channel, not to the entire overlay or to two paths. An intermediate browser validates its position in the declared path and forwards the envelope over the next permitted channel. Application-level routing does not modify IP routing or Wi-Fi behavior.

The host controls admission and topology. The coordinator and browser runtime are trusted. Each secure session generates an ECDSA P-256 identity whose private key remains in its browser. Authenticated signaling binds the public key to that session, with replacement rejected. Endpoint signatures cover the immutable envelope, including transfer ID, route, consent, bytes/hash and receipt; forwarding changes only next-hop, hop-index and TTL fields. This prevents a relay from forging a receiver completion while allowing legitimate hop advancement. Relays can still drop traffic and inspect payloads: WebRTC transport encryption is hop-by-hop, and this version does not provide end-to-end payload confidentiality.

## 3. Routing and recovery

The permitted graph and the observed graph are separate. The coordinator reports an established link only after both endpoints report an open DataChannel. Revoking a permitted edge removes its observations; adding it again requires new establishment. Closed connections cannot overwrite a newer connection's state through delayed callbacks.

Three strategies are implemented: minimum-hop BFS, Dijkstra over observed edge RTT, and an adaptive cost combining normalized RTT, loss/queue terms and a hop penalty. Unknown or stale metrics receive conservative costs. The current browser reports real RTT; loss and queued-byte inputs are not measured in this checkpoint, so their adaptive penalties remain conservative defaults rather than fabricated telemetry. This limits the interpretation of differences between adaptive and latency strategies.

For multipath, the solver enumerates simple paths within the eight-peer protocol bound, then selects the lowest-cost pair with no shared internal vertex or edge. This bounded exact search avoids the greedy failure in which the initially cheapest route blocks two otherwise compatible alternatives. The topology is limited to twenty edges. It is appropriate for the small laboratory, not intended as an Internet-scale routing algorithm. Direct baselines explicitly select their established direct edge; single-overlay baselines optimize their own single path rather than a pair's combined cost.

The sender retains a maximum of eight unconfirmed 32 KiB chunks. Each scheduling attempt has a route ID and sender-local monotonic timestamp. Only an ACK signed by the intended receiver, matching a recorded chunk/attempt and reversed path, increases unique acknowledgement accounting. Delayed or repeated ACKs cannot increase the unique byte count twice.

The sender detects a used route losing an established edge, stops assigning new chunks to it and reschedules its unconfirmed chunks over an available route. Changing the preferred route while the old path remains established is not counted as failure. ACK timeouts use a smoothed timing estimate, a 3-second floor, exponential backoff and a 30-second cap; ambiguous retransmission samples do not update the timing estimate. There are at most eight attempts per chunk, 60 seconds without receiver progress, and a 15-minute hard limit.

## 4. Integrity and state machine

```text
prepare → offer → receiver consent → transfer → verify → verified receipt
                  ↘ decline          ↘ failure/cancel
                                  missing ACK → alternate route → transfer
```

The offer contains file size, chunk size/count and SHA-256 digests. The receiver allocates bounded state only for a valid manifest and accepts or declines explicitly. Each chunk must match its declared index, length and digest. Hashing/assembly operations are serialized at the endpoint to avoid concurrent duplicate-final-chunk races across paths. Duplicate chunks are verified and acknowledged without adding their bytes again.

The receiver assembles in index order and checks the complete file hash. Only then does it expose a browser download and send a signed completion containing the digest and byte count. The sender requires that receipt to match its manifest. An ACK or completion-path send failure does not invalidate correctly stored bytes. If a final completion is lost after all chunk ACKs arrive, a bounded final-chunk probe causes the verified receiver to return its receipt again. Cancellation and terminal-state guards prevent late receipts from reopening a cancelled or failed transfer.

## 5. Experimental methodology

Keep payload size/hash, browser versions, device roles, foreground state, LAN type, strategy and topology fixed for each comparison. Use the same repeatable payload or the same custom file across trials. Record the actual receiver acceptance and ensure all required links say established before starting. Disable unrelated traffic where practical and document it rather than assuming equivalent conditions.

**A: Direct versus overlay.** Establish a direct endpoint channel and a route through one intermediate browser. Run separate direct and single-overlay trials with the same endpoints/payload.

**B: Single versus multipath.** Configure a diamond with two distinct relays. Compare one selected overlay route at a time with simultaneous chunk scheduling over two routes. The single-route strategy may reactively select another available route; this must be reported, rather than described as a physically single-path network.

**C: Failure recovery.** Start an accepted multipath transfer. After both paths have receiver-confirmed progress, close one relay browser or apply the host-authorized logical-link fault. Record which method was used. Verify continued delivery and download the reconstructed file for an independent SHA-256 check. Also test loss of every alternate path and report the bounded failure, not a successful recovery.

Each physical comparison should include at least five independent trials per condition, randomized condition order, and exported raw JSON/CSV. Report per-condition medians, range and preferably interquartile range from the actual trials. This checkpoint's UI displays a median/range only with at least three matching verified trials. It does not automatically label browser-context runs as independent physical experiments.

## 6. Measurements and evidence

Metric definitions are in `RESILIENCE_STUDIO.md`; exported results use sender-local monotonic timestamps. Payload throughput includes chunk forwarding, hashing, acknowledgements and receiver verification, but excludes the time waiting for consent. It is not raw Wi-Fi capacity. A receiver-ACK gap measures progress interruption observed by the sender, not a synchronized one-way transit time.

The browser recovery acceptance test creates four isolated Chrome contexts with actual RTCDataChannels, verifies chunk ACKs on both routes, closes one relay before completion, waits for verification, downloads the file and computes its digest independently in Node. The reproducible payload is 8,388,608 bytes in 256 chunks, with SHA-256 `2107effc55047b86e1aede2400e23b14bdf4c8614ce0ffa4b6a77123caf20f76`. Per-run attempts, failures, path history and local timestamps are preserved in `evidence/automated-relay-recovery.json`; these changing values must be read from the checked-in run, not copied from an earlier run as a universal benchmark.

The UI experiment test also exports and parses a completed Lab result and exercises conversation delivery and Replay controls at six acceptance viewports plus the design concept's native 1586×992 dimensions. These observations support implementation correctness and usability checks. They do not demonstrate a statistically significant speedup. No comparative performance plot is presented because sufficient independent comparative trials have not been collected.

## 7. Protocol Time Machine

Each recorded event has a local identity, type, monotonic/wall timestamps, provenance, optional transfer/experiment/chunk identifiers, a path where observed, and a snapshot of known peers, permissions and link state. Retention is bounded. Playback freezes a local event window and displays recorded state, with step, scrub, speed and event selection. No playback control sends packets. Missing remote observations and evicted history are acknowledged explicitly.

This permits evidence-based explanation: signaling versus data-plane establishment, overlay hops versus direct edges, final receiver ACKs versus relay forwarding, retries versus fresh chunks, and hash verification versus mere byte transmission. No generated chatbot narrative is needed.

## 8. Limitations and threats to validity

All automated browser contexts share one physical host, CPU, browser implementation and network stack. Rendering and tracing affect measured timing; bulk transfer tracing was disabled after large snapshots interfered with execution. Visual telemetry is batched while protocol events remain recorded. LAN phones have different CPU, browser scheduling, certificate stores and suspension policies. No result here establishes Safari/Android correctness or behavior under background suspension.

Application-level link removal is an emulated logical fault; browser closure is a real application participant failure. Neither is physical radio impairment. Public-key distribution depends on the trusted coordinator. Local history and room state are ephemeral. The bounded exact routing algorithm is limited to small topologies. Session chat receipts do not have the file protocol's endpoint signatures. There is no global synchronized event clock or globally merged journal. Real loss and queue sampling, end-to-end payload encryption, physical experimental trials and broader browser coverage remain future evaluation work.

## 9. Reproduction and review

Run `npm run check`, `npm run test:e2e -- --workers=1` and `npm audit --audit-level=high`. Inspect the exported raw evidence, screenshots and test source rather than treating a green status or route animation as sufficient proof. Follow `DEVICE_TESTING.md` and `RESILIENCE_STUDIO.md` for trusted LAN HTTPS and the physical demonstration. Physical acceptance must remain unchecked until those observations are supplied.

## Standards references

1. [W3C, WebRTC: Real-Time Communication in Browsers](https://www.w3.org/TR/webrtc/), Peer-to-peer Data API: the RTCDataChannel API and transport state underlying this implementation.
2. [W3C, Web Cryptography](https://www.w3.org/TR/webcrypto/), SubtleCrypto and ECDSA: the browser signing, verification and digest primitives used here.
3. [W3C, Secure Contexts](https://www.w3.org/TR/secure-contexts/), potentially trustworthy origins: context for distinguishing automated loopback behavior from a physical LAN origin.

These standards describe underlying platform capabilities; the repository tests and raw evidence support the implementation-specific results. No standard is cited as evidence that HOPNET passed a physical-device experiment.
