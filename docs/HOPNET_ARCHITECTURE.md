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
- Future `packages/transfer`: manifests, chunk scheduling, backpressure, receipts and integrity.

Room state is intentionally ephemeral in Phase 0. Private payloads are not stored or silently uploaded. The coordinator binds to the LAN only when the operator starts it.

## Phase 0 failure boundaries

- Invalid or expired invitation: join is rejected without revealing room state.
- Missing host bearer token: admission is rejected.
- Coordinator loss: established DataChannels may continue, but presence and new negotiation stop.
- ICE failure: the UI reports degraded state. A user may deliberately use the separately labeled WebSocket fallback.
- Mobile background suspension: the participant may become unavailable; HOPNET does not claim otherwise.

## Overlay source of truth

The host authors **permitted** edges. Browsers report observed `RTCPeerConnection` state for those edges to the coordinator. Routing uses only permitted edges whose latest application report is `direct`; a permitted line is not treated as usable merely because it exists in configuration. In Phase 2's default star, each admitted participant forms one DataChannel to the host. Participant-to-participant traffic therefore traverses the host browser as an actual application relay.
