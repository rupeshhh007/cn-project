# HOPNET product decisions

## Product truth

HOPNET is a local-first communication product and an application-layer overlay networking laboratory. It is not an IP router, radio mesh, Wi-Fi scanner, or network attack tool. Every live peer, link, message, byte count, and route must originate from current application state.

Measurements carry provenance:

- **REAL**: observed by HOPNET from a live coordinator socket, WebRTC connection, application envelope, local timer, or browser stats report.
- **EMULATED**: introduced deliberately by Lab controls, such as a logical edge disable or application delay.
- **INFERRED**: derived from observations with documented assumptions.

Demo-only data is never mixed into Live Space. Concept mockups under `docs/design/` are visual references and are not test evidence.

## Scope sequence

1. Authenticated room, host admission, LAN invitation and real two-device RTCDataChannel.
2. Five-device presence and direct messaging.
3. Operator-authored overlay, multi-hop forwarding, receipts and reroute.
4. Accepted, bounded-memory, integrity-checked file transfer.
5. Adaptive routing, disjoint multipath scheduling and recovery.
6. Reproducible experiment capture, replay, exports and report.

## Design direction

Composition A is the primary Live Space direction: a full-bleed network field, one dark command capsule, and one progressive inspector. Composition C's chronological proof ribbon informs Lab and Replay. The mobile concept defines the lean participant surface. The implementation uses code-native devices and filaments so their existence and state can be bound directly to protocol state.
