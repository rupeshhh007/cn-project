# HOPNET — The Network You Can Touch

HOPNET is a local-first peer communication product and application-level overlay networking laboratory. Real browser peers join an invitation-only LAN room, establish native WebRTC DataChannels, exchange acknowledged messages, and expose the difference between coordinator presence and the direct data plane.

This branch is the new HOPNET implementation. The earlier Review-1 work remains in `main`; the Sentinel implementation remains in `feature/sentinel-network-lab`.

## Current verified slice

Phase 0 is implemented:

- LAN coordinator URL discovery and QR invitation
- host-only peer admission
- authenticated WebSocket signaling
- perfect-negotiation WebRTC DataChannels with trickle ICE
- direct ping/echo and sender-local RTT measurement
- acknowledged direct messages
- selected ICE candidate-pair type from browser stats
- explicit, visibly labeled WebSocket fallback
- responsive atmospheric desktop and participant UI driven only by live state

Automated verification covers two isolated Chrome browser contexts on one machine. The required two-physical-device gate is intentionally not claimed until it is run using `docs/DEVICE_TESTING.md`.

## Run

Prerequisites: Node.js 20 or later and npm.

```bash
npm install
npm start
```

Open `http://localhost:4173` on the host. The terminal prints each detected LAN URL. Create a room, scan its QR code from another device, request admission, and approve it on the host.

For trusted LAN HTTPS, set `HOPNET_TLS_CERT` and `HOPNET_TLS_KEY` to a certificate/key pair trusted by every participating device.

## Verify

```bash
npm run check
npm run test:e2e
npm audit --audit-level=high
```

The end-to-end test uses locally installed Chrome and writes inspected screenshots to `docs/screenshots/`.

## Documentation

- [Product decisions](docs/PRODUCT_DECISIONS.md)
- [Architecture](docs/HOPNET_ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [Test plan](docs/TEST_PLAN.md)
- [Physical-device procedure](docs/DEVICE_TESTING.md)
- [Milestones](docs/MILESTONES.md)

HOPNET is an overlay on an existing WLAN. It does not perform IP routing, physical-radio mesh networking, SSID/MAC discovery, packet spoofing, or network disruption.
