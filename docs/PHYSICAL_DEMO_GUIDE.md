# Physical demo: recovery without rebuilding the room

Use this beside `DEVICE_TESTING.md`. Automated Chrome contexts are logical routers on one computer, not four physical devices. The final two-laptop/two-phone run remains a human acceptance gate.

## Preflight (before faculty arrive)

1. Use the same non-isolated Wi-Fi/hotspot on all devices. Disable VPN and cellular fallback. Plug in phones, turn off automatic screen lock for the demo, and keep relay tabs foregrounded. Background mobile execution is not guaranteed.
2. Follow the **trusted LAN HTTPS** section in `DEVICE_TESTING.md`: run `npm run doctor`, generate a certificate for the current Wi-Fi IP, install only the public mkcert CA on the other devices, then start with `HOPNET_TLS_CERT` and `HOPNET_TLS_KEY`. Never share either private key. Each device must show **Secure browser context**, without a certificate warning. Regenerate the server certificate if its IP changes.
3. After a production build, restart only the HOPNET coordinator so its registered asset filenames match that build. Load the same build on every peer. Use the HTTPS LAN address, not localhost. Do not switch between LAN-IP and localhost origins: browser session storage is origin scoped.
4. Create **Source** on Laptop 1. **Room invitation** is permanently available on desktop and mobile. Select the Wi-Fi interface; verify the complete copied invitation uses `https://CURRENT_LAN_IP:4173`. Treat the invitation and QR as secrets; mask them in public screenshots.

## Quick two-device gate: MacBook + Android

1. Scan Source's QR on Chrome Android. Name it **Phone**, choose Phone, request admission. Source opens Room invitation and presses **Admit**. Check the pending request disappears on Source and the phone enters the room. Try **Reject** with a separate test request if desired.
2. Wait for an actual open WebRTC channel and an active Hello neighbor. Press **Ping over WebRTC**; record a fresh RTT, not a historical value.
3. Send unique messages in both directions. In Send/Messages, wait for **delivered**, not just “Awaiting receiver receipt.” Confirm one receiver bubble per message. Never use coordinator fallback as networking evidence.
4. Send a small file, explicitly accept on the receiver, wait for **verified** on both endpoints, then save it. On macOS run `shasum -a 256 ORIGINAL_FILE DOWNLOADED_FILE`; compare both hashes. For a phone download, copy that exact downloaded file back by cable and hash it, or use a trusted offline hash utility. Do not substitute the UI hash for an independent download check.
5. Reload the phone. It should recover the same named peer without another Admit, then show newly negotiated WebRTC/Hello readiness. Routing tables start afresh. Ping and send a new acknowledged message. Reload Source too; its invitation and host controls must return.
6. Reload while an accepted larger file is still progressing: the other endpoint must show **failed / peer refreshed or restarted**, not verified. Offer a new file and accept again. History/download assembly is not persisted across reload.

## Four independent physical routers

Admit **Relay One** (Phone 1), **Relay Two** (Phone 2), and **Destination** (Laptop 2) from Source's current invitation. Keep all four browsers visible and foregrounded.

In Source's Lab, choose Destination as **Experiment receiver**. Set exactly these permitted edges (four enabled, two disabled):

| Enabled | Disabled |
| --- | --- |
| Source ↔ Relay One | Source ↔ Destination |
| Source ↔ Relay Two | Relay One ↔ Relay Two |
| Relay One ↔ Destination | |
| Relay Two ↔ Destination | |

Wait for **2 established routes**. Permissions alone do not establish channels. In Routing, inspect all four routers: local truth on each physical device, and RTC-flooded remote snapshots where reachable. Each LSDB should describe four routers; inspect Hello/LSA counts and Source's actual Destination next hop. Export router JSON/forwarding CSV before failures. Record device/browser/OS versions, date, Wi-Fi topology and software commit separately from secret-bearing invitation details.

### Message/browser failure

1. Note Source's actual next hop, then close that relay's browser/tab. This is a browser failure, not Lab's logical fault. Wait for its channel/Hello withdrawal and a new next hop through the survivor.
2. Send a unique message to Destination. Show its receiver bubble, Source's ACK, actual intermediate forwarding in Replay, and before/after routing exports. A terminal **Delivery unconfirmed** means no confirmed success; it does not prove zero delivery.
3. Reopen the *same tab* using browser reopen/restore where supported. If its session storage survives, it resumes the same identity and allowed edges renegotiate. If the browser discarded storage (some tab-close/private modes), use a new invitation and admission; do not claim persistent identity in that case. Accidental reload is the tested recovery path.

### Repeatable logical failure and restoration

1. With both routes established, select Relay One under **Failure relay**, press **Disconnect relay links**. Observe one route, new LSAs and the local next hop; send a unique acknowledged message through Relay Two.
2. Press **Restore relay links**. Wait for fresh WebRTC negotiation and Hello exchanges, then **2 established routes**. Repeat at least twice without creating a new room.
3. Separately reload a relay. Its identity should stay the same and both routes return without admission. Refresh does not grant revoked links: if Source removed an edge, it stays absent until Source explicitly restores it.

### Multipath file recovery

1. Start with two established paths, select a repeatable file large enough to interrupt mid-progress, select the desired strategy and multipath mode, and start the trial. Destination explicitly accepts.
2. Verify **receiver-acknowledged chunks on both paths**, not merely attempted sends. During progress disconnect one relay's links with the Lab control. This is application-level logical fault injection; Wi-Fi stays on.
3. Wait for retry/recovery and an authenticated receiver completion receipt. Save and independently hash the downloaded file. Export trial JSON/CSV and Replay events; note the failure type and actual bytes, retries, per-path confirmations and fault-to-ACK-progress interval. Restore and repeat.
4. For a valid comparative experiment use the **same file, byte count, hash, topology, strategy and fault timing**, repeat trials and report variance. Do not compare different payload sizes as performance evidence.

### Negative gate

Remove both relay routes. Destination must become unreachable; no success may be invented. A previously started message may retry but becomes delivery-unconfirmed after its 30-second ACK deadline. A file without receiver progress fails at its existing 60-second no-progress deadline, or can be cancelled locally immediately. A partitioned peer may not learn remote cancellation. Restore links and send a new message/file; do not relabel an old failed result as success.

## When something disagrees

- **Signaling disconnected + Direct WebRTC + active Hello** can be legitimate: an existing peer channel does not depend on a live coordinator. If signaling is down, new negotiations/admin changes may be unavailable. Use route/neighbor state for reachability; bytes are recorded totals, not throughput.
- **RTT historical** is not a new sample. Foreground the peer and ping after it reconnects. Remote Routing reports carry observer-local age; they are snapshots, not a synchronized remote clock.
- **Session expired** after coordinator restart is expected: server rooms are memory-only. Create a new room. Do not repeatedly restore a token into a nonexistent room.
- **Already open in another tab**: use the original tab or a fresh invitation for an independent router. Never count a duplicated authenticated tab as an independent physical device.
- **Old IP / network change**: same-origin recovery cannot migrate to a different origin. Update LAN URL/certificate, reopen that origin and re-admit if needed. This is different from a relay link fault.

For each physical gate retain screenshots (QR/tokens masked), local/remote router exports, trial JSON/CSV, Replay journal, original/download SHA-256 and any errors. Explicitly record pass/fail/not-run. No automated or manually reported measurement substitutes for the final four-physical-device run.
