# HOPNET Resilience Studio

This checkpoint extends the existing HOPNET application. It does not replace Sentinel or merge into `main`. PR #1 was verified open at inspection, fetched, reviewed and merged into `codex/hopnet-resilience-studio`. The baseline remote `feat/hopnet-lan` was confirmed at `1683052`.

## Run

```bash
npm ci
npm run doctor
npm start
```

Loopback Chrome is a secure browser context for automated testing. Physical LAN file transfers require trusted HTTPS; ordinary LAN HTTP cannot initialize Web Crypto or a transfer signing identity.

The interface discovered on 2026-10-20 was `en0`, `172.17.96.201`. Re-run Doctor before every physical session: addresses can change.

```bash
brew install mkcert
mkcert -install
mkdir -p .certs
mkcert -cert-file .certs/hopnet.pem -key-file .certs/hopnet-key.pem localhost 127.0.0.1 172.17.96.201
HOPNET_TLS_CERT="$PWD/.certs/hopnet.pem" HOPNET_TLS_KEY="$PWD/.certs/hopnet-key.pem" npm run doctor
HOPNET_TLS_CERT="$PWD/.certs/hopnet.pem" HOPNET_TLS_KEY="$PWD/.certs/hopnet-key.pem" npm start
```

Install and trust **only** the local CA certificate on the other MacBook and phones, as described in `DEVICE_TESTING.md`. Keep the private key on the host. Doctor checks certificate readability and address coverage; only the receiving browser can confirm its local CA trust. Do not bypass certificate warnings.

## Establish a diamond

Use four admitted browsers: host Sender, Relay One, Relay Two, Receiver. A fifth browser may observe or form another permitted path. Every device should remain foregrounded.

In **Lab**, choose Receiver. Remove Sender ↔ Receiver if present. Permit:

1. Sender ↔ Relay One.
2. Relay One ↔ Receiver.
3. Sender ↔ Relay Two.
4. Relay Two ↔ Receiver.

Wait for all four links to say **established**, and for the route list to show two paths. Coordinator link state requires both endpoint reports to be `direct`; browsers report `direct` only when their DataChannel is open. Topology permissions, negotiation and established links have distinct labels. The disjoint solver examines simple routes within the wire protocol's eight-peer limit, chooses a compatible pair by combined strategy cost, and never counts the same direct edge twice.

## Execute a trial

Choose A (direct/overlay), B (one/two overlay routes), or C (failure recovery), a receiver, strategy, and payload. A custom file or the repeatable 4 MiB payload uses the same transfer protocol. Start the experiment, then open **Send** on the receiver and accept. The sender cannot infer consent from a relay.

For C, wait for receiver-confirmed progress on both paths, choose an intermediate relay, and press **Disconnect relay links** while the transfer is active. This is explicitly application-level fault injection: the host revokes those permitted links and the browsers close their RTC channels. It does not impair physical Wi-Fi. Alternatively close the relay browser for an actual browser-failure trial. The automated recovery gate uses browser closure.

Only unacknowledged chunks are rescheduled. Completed chunks remain stored at the receiver. A complete matching SHA-256 and a signed receiver receipt are required before the sender reports verified. Save the file at the receiver and independently compare `shasum -a 256` on macOS. If all routes disappear, lack of receiver progress ends the transfer with a clear error after 60 seconds; the hard resource limit is 15 minutes.

Restore the permitted links before another trial. Repeat each comparison under the same file, devices, strategy, foreground conditions and topology. Each trial requires consent. The UI retains 12 experiments and reports a median and range only after at least three matching verified trials; it does not pool different route modes or payload sizes. Export JSON/CSV before reloading.

## Measurements and replay

All durations are sender-local `performance.now()` differences. Device wall clocks are never subtracted.

| Measurement | Definition |
| --- | --- |
| Completion time | Verified receiver receipt observed minus receiver acceptance observed at sender |
| Throughput | Original payload bytes / completion duration, excluding consent delay and all framing/signaling bytes |
| Individual chunk ACKs | Unique sent chunk/route IDs confirmed by a signed final-receiver ACK |
| Receiver-confirmed bytes | Unique acknowledged bytes; a verified final receipt also proves whole-file byte count |
| Retries | Extra chunk scheduling attempts, including a final-chunk completion-receipt probe |
| Path failures | Previously used routes observed to lose an established edge, not a strategy preferring another route |
| Failure detection | First recorded path-unavailable observation minus sender-local fault command time |
| Recovery time | First receiver ACK after detection minus fault command time |
| ACK interruption | First post-detection ACK minus last ACK before the command |
| RTT | A real RTC ping/echo round trip on an established edge, refreshed every 10 seconds |

ACK latency includes forwarding, hashing and browser scheduling. The recovery and interruption measures are observations of ACK progress, not proof of a precise instant at which physical traffic stopped. Browser-closure experiments without a sender-local fault command export null fault-relative timing. These fields must not be relabeled physical-network detection latency.

The latest 2048 local journal entries capture protocol events and observed topology snapshots. Each transfer retains its latest 4096 scheduling/ACK events. Replay freezes a journal window on entry; scrub, step, speed and playback operate on that window. **Load latest journal** explicitly refreshes it. Historical route highlighting uses the event's recorded path. Playback does not invoke a networking action. Missing remote observations or evicted history are not reconstructed.

## Security and limits

Transfer envelopes use ECDSA P-256/SHA-256 endpoint signatures. An authenticated coordinator socket binds an ephemeral public key to its own session; it cannot replace an existing session key. The immutable signed fields include transfer ID, endpoints, route, consent, chunk metadata/content and verification result. Forwarders can change only hop-local next-hop/index/TTL fields. Receipts must match the intended receiver and sent attempt. Whole-file hashes and per-chunk hashes remain mandatory.

The coordinator is trusted for admission, identity distribution and permissions; relays can observe payloads because this implementation has hop-by-hop WebRTC encryption, not end-to-end payload confidentiality. Signatures prevent an intermediate relay from inventing a successful endpoint receipt; they cannot prevent an admitted endpoint from lying about itself or a relay from withholding traffic. Conversation receipts do not yet have the file protocol's endpoint signatures.

Limits: 32 MiB/file, 32 KiB/chunk, 1024 chunks, eight peers/route, twenty permitted edges, eight outstanding chunks (256 KiB payload), two active transfers/device, eight attempts/chunk, exponential bounded RTO (3–30 seconds) with smoothed ACK timing and retransmission ambiguity exclusion. Retained completed transfers and download URLs are bounded and cleaned at retention eviction or session teardown. Session conversations retain 300 messages in memory only. No invitation, bearer token, private key or file contents are included in journal/export records.

## Verification classification

- **Automated browser experiments:** isolated Chrome browser contexts and actual RTCDataChannels over the local host. See raw evidence in `docs/evidence/` and screenshot captures in `docs/screenshots/studio/`.
- **Unit/integration tests:** deterministic routing graphs, simulated transport protocol tests, signature tampering, cancellation, consent and timeout checks. These are not physical-device experiments.
- **Emulated application impairment:** host-controlled removal of logical links. Not physical radio/network impairment.
- **Physical device experiments:** pending the user's two MacBooks and three phones. No physical result is claimed.
- **Inferred measurements:** incomplete or unobserved fields remain null; no benchmark improvement is asserted.

The final acceptance remains pending physical five-device execution, Safari/Android browser verification, and a human comparison against the original dimensional design references. The automated suite is necessary evidence, not a substitute for those checks.
