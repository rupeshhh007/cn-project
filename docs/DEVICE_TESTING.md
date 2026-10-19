# Physical-device LAN verification

Automated browser tests are not a substitute for this gate. Record every device, browser, OS, network, and result. Do not mark a step passed without evidence from the physical devices.

## 1. Preflight the host

On Mac A, from the repository:

```bash
npm install
npm run doctor
npm start
```

Use the `LAN*`/`USE` address printed by HOPNET, not `localhost`. Open that address on Mac A, create a room, and confirm the QR code uses the same IP. If more than one interface is listed, choose the Wi-Fi or hotspot address in **Invitation address**.

## 2. Establish trusted LAN HTTPS

HTTP is sufficient for basic room and DataChannel diagnosis, but the verified-transfer milestone requires a secure browser context. One reproducible local setup is `mkcert`:

```bash
brew install mkcert
mkcert -install
mkcert -cert-file .certs/hopnet.pem -key-file .certs/hopnet-key.pem localhost 127.0.0.1 YOUR_LAN_IP
HOPNET_TLS_CERT="$PWD/.certs/hopnet.pem" HOPNET_TLS_KEY="$PWD/.certs/hopnet-key.pem" npm run doctor
HOPNET_TLS_CERT="$PWD/.certs/hopnet.pem" HOPNET_TLS_KEY="$PWD/.certs/hopnet-key.pem" npm start
```

Replace `YOUR_LAN_IP` with the address printed by `npm run doctor`; regenerate the certificate when that address changes. Trust the generated local CA on Mac B. On iOS, transfer only the CA certificate, install the profile, then enable full trust under **Settings → General → About → Certificate Trust Settings**. On Android, install the CA certificate from the device security settings. Remove the test CA from mobile devices after the demonstration. Never transfer the private key.

To locate the CA certificate on the host, run `mkcert -CAROOT`; copy only the resulting `rootCA.pem` to the phones using AirDrop or a local cable.

Each browser must show a valid HTTPS origin with no certificate warning and the HOPNET onboarding card must say **Secure browser context**.

## 3. Two-device WebRTC gate

1. Put Mac A and Phone A on the same Wi-Fi or personal hotspot. Disable VPN, Private Relay, and cellular fallback for the test.
2. Scan the QR code on Phone A. The URL must contain Mac A's LAN IP, never `localhost` or `127.0.0.1`.
3. Request admission and press **Admit** on Mac A.
4. Keep both tabs foregrounded until **Direct WebRTC** appears.
5. Press **Ping over WebRTC**, then send a unique message.
6. Record the candidate pair, measured RTT, sender acknowledgement, and receiver message event.

Evidence required:

- One screenshot per device after admission, with secrets cropped or redacted.
- Sender evidence showing direct state, candidate type, RTT, and receiver acknowledgement.
- Receiver evidence showing the unique message.
- Coordinator terminal output from startup through the test, with invitation/session secrets redacted.
- Browser console errors and the exact browser/OS versions.

## 4. Five-device gate

Repeat admission for Mac B and the remaining phones. Verify every displayed device corresponds to an approved physical browser. Do not count stale/offline peers as present. Run a direct ping on every permitted link before starting multi-hop or file tests.

## 5. Accepted file and relay gate

1. With two devices connected, choose a small file from the sender. Confirm the receiver sees its name and size and must press **Accept** before bytes move.
2. Save the received file. Compare its SHA-256 with the sender's original using `shasum -a 256 FILE` on macOS.
3. Admit a third device and use the default sender → relay → receiver route. Repeat with a unique file.
4. Capture the sender's receiver-verified completion, the receiver's SHA-256 verified state, and the intermediate peer's real forwarding event.
5. Record file size, acknowledged bytes/chunks, start/end time, and any retry or route-change event. Do not infer throughput from animation time.

The browser E2E suite verifies these flows with isolated Chrome contexts. Physical transfer, secure-certificate trust on the phones, and relay-failure recovery remain separate manual gates.

## Failure isolation

1. Confirm the participant can load the selected LAN origin before testing the QR.
2. Run `npm run doctor` again after changing Wi-Fi or hotspot.
3. Check macOS Firewall permission for Node.
4. Disable guest/client isolation; campus Wi-Fi commonly blocks peer host candidates.
5. Keep mobile browsers foregrounded. iOS and Android may suspend relay work in the background.
6. Try a personal hotspot and record whether the failure changes.

The explicit coordinator fallback proves only control-plane reachability. It does not pass the direct WebRTC gate.
