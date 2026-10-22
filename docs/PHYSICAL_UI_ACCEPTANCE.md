# HOPNET physical-device UI and HTTPS acceptance

This branch addresses issues observed in the October 19 real-device screenshots. The code changes are not physical-device test evidence.

## Before testing

1. Preserve any local uncommitted work.
2. Run `git fetch origin`, check the repair PR, and work from a clean checkout.
3. Run `npm install`, `npm run check`, and `npm run test:e2e`.
4. Start the LAN host with `npm run doctor` and `npm start`.

## Trusted HTTPS for file integrity

A web page opened on a phone at `http://192.168.x.x:4173` is generally not a secure context. Web Crypto `crypto.subtle` is therefore unavailable. A Mac opened at `http://localhost:4173` can still be a secure context, which caused sender/receiver mismatches.

For the actual phone transfer gate, use `mkcert` and a locally trusted CA as documented in `docs/DEVICE_TESTING.md`:

1. Discover the LAN IP via `npm run doctor`.
2. Generate a certificate including the current LAN IP (and localhost) using mkcert.
3. Run HOPNET with `HOPNET_TLS_CERT` and `HOPNET_TLS_KEY`.
4. Trust the **CA certificate only** on each device; never transfer or share the generated private key.
5. Open the same trusted `https://LAN_IP:4173` origin on both peers, with no certificate warnings.
6. Verify `window.isSecureContext` and `crypto.subtle` are available.
7. Only then attempt receiver-consented SHA-256 verified file transfer.

An insecure receiving browser should now decline the offer before data chunks start, rather than causing repeated chunk retries. This does not make HTTP cryptographically secure or bypass a browser's secure-context rules.

## Manual UI checks

- Desktop: with two peers connected, the hero no longer obscures the central phone/device.
- Desktop: inspector is scrollable without covering the bottom activity ribbon.
- Desktop: Replay opens a contained event panel and closes back to Space.
- Desktop: the paperclip opens the browser's file selection only when both an overlay route and secure context exist.
- Mobile: Room, Messages, and Activity tabs navigate to distinct content; each tab has a visible active state.
- Mobile: Activity shows real recorded events and is not visually clipped.
- Mobile: Room shows peer presence and permits the host to admit pending participants.
- Mobile: Messages shows the selected peer, usable routing/ping controls, and a file action with HTTPS guidance.
- Mobile: page content scrolls without fixed controls obscuring the last card.
- Sender on trusted HTTPS and receiver on insecure HTTP: the receiver rejects a file offer with an actionable secure-context reason; sender does not exhaust chunk retries.
- Both peers on trusted HTTPS: file transfer succeeds and receiver and sender agree on SHA-256.
- At least one 390x844 and one 1440x900 screenshot are checked for overlaps and usability.

## Important still-open engineering work

This repair does not implement a message conversation inbox, true timeline playback or the research lab; those require separate verified vertical slices. It also does not certify operation on two physical devices. The latest `feat/hopnet-lan` may move while this PR is under review, so rebase/merge only after checking conflicts and rerunning tests.
