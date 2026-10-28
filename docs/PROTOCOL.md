# HOPNET protocol v1

## Control plane

All WebSocket messages are JSON and runtime validated. Authenticated clients may send `signal`, explicit `relay-data`, and `heartbeat`. The coordinator sends room snapshots, peer presence, host admission requests, signaling messages, fallback payloads and errors.

WebRTC signaling uses the perfect-negotiation pattern. ICE candidates are trickled. Phase 0 intentionally supplies no public STUN/TURN dependency; peers on a compatible LAN use host candidates. This keeps the final demo local but means client isolation or browser/router policy can prevent a direct path.

## Data plane

The `hopnet-control` reliable ordered RTCDataChannel carries v1 packets:

- `ping`: UUID and sender-local high-resolution timestamp.
- `pong`: same UUID and echo metadata. RTT is computed only on the originating device.
- `message`: UUID, timestamp and bounded UTF-8 body.
- `message-ack`: receiver confirmation for the same UUID. A sender does not call a message delivered merely because `RTCDataChannel.send()` returned.
- Transfer packets: accepted manifest offer, accept/decline response, bounded base64 chunk with its SHA-256, receiver chunk acknowledgement, and a final receiver completion receipt. The sender counts acknowledged bytes and reports verified only when the receipt matches the offered full-file SHA-256 and byte count.

Unknown protocol versions and malformed packets are rejected. Routed envelopes add source, destination, path, hop index, TTL and route proof while preserving the same versioned validation boundary.

## Routed v1 messages

`routed-message` and `route-receipt` carry `messageId`, `sourcePeerId`, `destinationPeerId`, `routeId`, `nextHop`, full `path`, `hopIndex`, `ttl`, and `createdAt`. Each receiver verifies that it is the declared current hop, that the next forwarding edge is permitted, and that TTL remains. A bounded 60-second duplicate cache rejects repeated route/hop tuples. The destination returns a receipt over the reversed path. Every forwarding browser records the event locally.

The central coordinator carries signaling and topology state only. Routed payload envelopes move over the selected RTCDataChannels; the WebSocket relay remains a separately selected fallback.

## File transfer limits and integrity

The protocol caps file size at 32 MiB, chunk payloads at 32 KiB before encoding, and path length at 8 peers. The current sender uses 32 KiB chunks, encoded within a 44 KB schema bound, to reduce per-chunk verification and forwarding overhead while staying within conservative RTCDataChannel message limits. Chunks are individually SHA-256 checked before receiver acknowledgement; final assembly must match the manifest hash before a download URL or verified completion is emitted. Integrity relies on browser Web Crypto and therefore requires a secure context on the physical device.

## Security properties

### Resilience Studio extension

Secure sessions publish an ephemeral ECDSA P-256 verification key through authenticated signaling (`publish-receipt-key`, `peer-key-updated`). The coordinator binds the key to that session only and rejects replacement. Every transfer envelope includes an endpoint signature; canonical signing excludes only `signature`, `nextHop`, `hopIndex`, and `ttl`. A relay may advance those hop-local fields, but cannot alter endpoints, full path, transfer/attempt identity, consent, bytes, digest or completion result. Endpoint verification precedes application processing.

`transfer-chunk-ack` echoes the exact chunk attempt's route ID and reverses its path. Unique matching final-receiver ACKs update accounting once. `transfer-cancel` terminates an active endpoint transfer. Verified receivers respond idempotently to a repeated final chunk, allowing recovery of a lost completion receipt. Failed/cancelled transfers ignore later completion. Receivers stop inactive transfers after their no-progress deadline; a failed reverse-channel send does not invalidate a correctly stored or verified file.

This extension requires matching current HOPNET clients. It is not compatible with unsigned file-transfer clients from the earlier checkpoint; they must reload. Chat packet semantics are unchanged.

- Invitations contain a random room secret.
- Joining creates only a pending request.
- Only the host bearer token can admit a request.
- A successful claim returns a random peer session token.
- WebSocket payloads and REST bodies are bounded.
- Display labels are sanitized and rendered as React text.
- Explicit fallback is size-limited and visibly classified; it is never described as peer-to-peer.
- Invitation QR origins are restricted to coordinator-discovered interfaces and never inferred from an untrusted `Host` header.
- Network-discovery and QR responses are `no-store`; invitation secrets remain bearer capabilities and must be redacted from evidence.

# Session recovery extension — 22 October 2026

Authenticated POST `/api/rooms/:roomId/resume` accepts a UUID attemptId with the existing session Bearer capability, preserves membership and permitted edges, clears the ephemeral receipt key/link observations and rotates the peer generation. The same attempt is idempotent. A fresh runtime republishes a new key; no private key is persisted. GET `/session` validates existing identity. GET `/pending` and POST `/reject` require the host capability. The authenticated host socket receives `pending-requests` snapshots on connection/mutation; claim tokens are never in that snapshot. Join retry UUIDs deduplicate admission requests; pending/claim TTL is 15 minutes, with 20 pending and 20 rejected tombstones maximum.

`Peer.generation`, control-packet generation, LSA observation generation and data-packet sourceGeneration/destinationGeneration distinguish authenticated reload incarnations from old packets. Omitted generations mean legacy zero; generations come from coordinator membership, not flooded reports. Old incarnations cannot revive an LSA watermark or complete/deliver a new-incarnation message. Endpoint restart fails pending messages/transfers honestly; relay restart can still use existing alternate-route recovery. **Reload every peer after upgrading**; do not mix protocol implementations in the presentation. Protocol version stays 1 with optional additive fields; this is not a promise that old clients understand recovery semantics.

See `SESSION_RECOVERY_20261022.md` for the trust model, browser-storage limits and lifecycle. The existing networking/transfer contract above is preserved.
