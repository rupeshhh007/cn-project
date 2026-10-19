# HOPNET architecture

## Planes

```text
Browser peer A ───── RTCDataChannel ───── Browser peer B
      │                                         │
      └──── authenticated WebSocket signaling ──┘
                         │
                 Coordinator on Mac A
```

The coordinator is the control plane: room membership, host admission, presence, WebRTC signaling and an explicitly selected fallback relay. Normal peer payloads use native WebRTC DataChannels. A coordinator connection is never displayed as a direct peer link.

## Modules

- `packages/protocol`: runtime-validated wire contracts shared by browser and coordinator.
- `apps/coordinator`: in-memory short-lived rooms, authorization, QR invitations, signaling, presence and bounded fallback messages.
- `apps/web`: room entry, host admission, live peer space, perfect-negotiation WebRTC manager, RTC ping/echo and truthful diagnostics.
- `packages/routing`: validated undirected overlay graphs, BFS, weighted Dijkstra, adaptive edge cost and node-disjoint path selection.
- `packages/transfer`: bounded manifests, 32 KiB chunking, backpressure, per-chunk and whole-file SHA-256, receiver consent and receipts, retry scheduling across currently measured paths.

## LAN origin selection

The coordinator discovers non-loopback IPv4 interfaces, ranks ordinary private Wi-Fi/Ethernet addresses ahead of tunnel and link-local adapters, and publishes them through `/api/network`. The browser uses the preferred origin for copyable invitations and QR codes even when the host UI was opened at `localhost`. The QR endpoint accepts only exact origins from that server-generated allow-list; it never trusts the HTTP `Host` header or an arbitrary query origin.

`npm run doctor` exposes the same decision before a room is created. Trusted HTTPS remains a deployment property: the certificate must cover the selected LAN address and its CA must be trusted by every physical browser.

## File transfer path

The sender hashes the complete file and each 32 KiB chunk before offering a bounded manifest. The destination must accept before chunks are scheduled. Chunks use reliable ordered RTCDataChannels hop by hop; intermediates validate the declared path and permitted next edge, then forward the envelope. The destination verifies each chunk before acknowledging it, reassembles only after every chunk arrives, and verifies the whole-file digest before making a download available. It returns the verified digest and byte count over the reverse route. The sender displays completion only when that receiver receipt matches its original manifest. Missing acknowledgements are retried on currently measured routes; interrupted physical-link recovery still requires hardware validation.

Room state is intentionally ephemeral in Phase 0. Private payloads are not stored or silently uploaded. The coordinator binds to the LAN only when the operator starts it.

## Phase 0 failure boundaries

- Invalid or expired invitation: join is rejected without revealing room state.
- Missing host bearer token: admission is rejected.
- Coordinator loss: established DataChannels may continue, but presence and new negotiation stop.
- ICE failure: the UI reports degraded state. A user may deliberately use the separately labeled WebSocket fallback.
- Mobile background suspension: the participant may become unavailable; HOPNET does not claim otherwise.

## Overlay source of truth

The host authors **permitted** edges. Browsers report observed `RTCPeerConnection` state for those edges to the coordinator. Routing uses only permitted edges whose latest application report is `direct`; a permitted line is not treated as usable merely because it exists in configuration. In Phase 2's default star, each admitted participant forms one DataChannel to the host. Participant-to-participant traffic therefore traverses the host browser as an actual application relay.
