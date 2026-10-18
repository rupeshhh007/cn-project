# Phase 0 physical-device verification

## Start the LAN host

```bash
npm install
npm start
```

Open the printed `http://localhost:4173` address on Mac A. Create a room, then scan the displayed QR code from Phone A or open the printed LAN origin and invitation URL on Mac B. Enter a real device label, request admission, and press **Admit** on the host.

Keep both browser tabs foregrounded. Select the admitted peer. Wait for **Data plane: direct**, then press **Ping over WebRTC** and send a short message. Record the peer inspector and event ribbon on both devices.

## Evidence to return

- Device/browser/OS pairs and Wi-Fi or hotspot topology.
- Screenshot from each device after admission.
- Sender screenshot after direct ping, including RTT and candidate type.
- Receiver screenshot containing the message event.
- Coordinator terminal output from startup through the test, with secrets redacted.
- Any errors from the browser console.

## If direct WebRTC does not open

1. Confirm both devices are on the same non-isolated LAN and the phone is not using cellular/VPN/private relay for the local URL.
2. Keep both tabs foregrounded and reload the participant once.
3. Check macOS Firewall permission for Node and verify the LAN URL itself loads.
4. Try a personal hotspot; campus/client-isolated Wi-Fi commonly blocks peer host candidates.
5. Report each inspector's state and console error. The explicit coordinator fallback can verify room communication, but it does **not** pass the direct WebRTC gate.

## Optional trusted LAN HTTPS

Some optional browser APIs require a secure context at a LAN IP. HOPNET accepts a locally trusted certificate and key:

```bash
HOPNET_TLS_CERT=/absolute/path/to/cert.pem HOPNET_TLS_KEY=/absolute/path/to/key.pem npm start
```

The certificate must contain the Mac's current LAN IP or hostname and its issuing local CA must be trusted on every test device. WebRTC DataChannels themselves do not require camera or microphone permission, so test HTTP first and introduce HTTPS only when the target browser requires it.
