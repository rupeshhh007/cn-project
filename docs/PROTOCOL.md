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

Unknown protocol versions and malformed packets are rejected. Routed envelopes add source, destination, path, hop index, TTL and route proof while preserving the same versioned validation boundary.

## Routed v1 messages

`routed-message` and `route-receipt` carry `messageId`, `sourcePeerId`, `destinationPeerId`, `routeId`, `nextHop`, full `path`, `hopIndex`, `ttl`, and `createdAt`. Each receiver verifies that it is the declared current hop, that the next forwarding edge is permitted, and that TTL remains. A bounded 60-second duplicate cache rejects repeated route/hop tuples. The destination returns a receipt over the reversed path. Every forwarding browser records the event locally.

The central coordinator carries signaling and topology state only. Routed payload envelopes move over the selected RTCDataChannels; the WebSocket relay remains a separately selected fallback.

## Security properties

- Invitations contain a random room secret.
- Joining creates only a pending request.
- Only the host bearer token can admit a request.
- A successful claim returns a random peer session token.
- WebSocket payloads and REST bodies are bounded.
- Display labels are sanitized and rendered as React text.
- Explicit fallback is size-limited and visibly classified; it is never described as peer-to-peer.
- Invitation QR origins are restricted to coordinator-discovered interfaces and never inferred from an untrusted `Host` header.
- Network-discovery and QR responses are `no-store`; invitation secrets remain bearer capabilities and must be redacted from evidence.
