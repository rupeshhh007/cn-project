# HOPNET public HTTPS deployment

Deployment target authorized on 29 October 2026: one **free Render web service** in the user's confirmed **My Workspace**, source branch `codex/hopnet-cn-studio`. PR #3 remains a draft targeting `feat/hopnet-lan`; no merge into either feature base or main is required to deploy this branch.

## What is hosted

One Node service serves the built frontend, REST admission/session API, QR generation and authenticated WebSocket signaling. It is **not a static-only demo**. Messages, probes and files still use actual peer RTCDataChannels; hosting the coordinator does not simulate peers or turn relays into server-computed routes. A database, worker, paid compute plan and TURN server are not provisioned.

Render MCP/Dashboard service configuration is the deployment source of truth (direct single-service creation, not a Blueprint). Use:

- Repository: `https://github.com/rupeshhh007/cn-project`
- Branch: `codex/hopnet-cn-studio`
- Runtime: Node; explicit `NODE_VERSION=24.22.1`, `NODE_ENV=production`
- Build: `npm ci --include=dev && npm run build`
- Start: `node --import tsx apps/coordinator/src/server.ts`
- Host: existing `0.0.0.0`; port: provider's `PORT`
- Public TLS terminates at Render; `/signal` uses `wss:` from the page's HTTPS origin.
- Default TCP readiness plus explicit external `/api/health` and browser verification. The creation tool does not expose an HTTP health-path setting.
- One instance only: room/session state is memory-local and is not shared across replicas.

No credentials, local certificates, room tokens or private signing keys are uploaded as environment variables. Render's documented `RENDER_EXTERNAL_URL` supplies the trusted public origin. An optional administrator-set `HOPNET_PUBLIC_ORIGIN` supports other trusted TLS proxies/custom origins and must be HTTPS with no credentials, path, query or fragment. Hosted network discovery exposes no private container interfaces; invitation QR origins are allow-listed to this configured URL, never inferred from request Host/Forwarded headers. Local mode without either variable preserves LAN-interface discovery and mkcert instructions.

Public room creation is capped at 128 concurrent retained rooms; existing peer/admission/payload caps remain. This is classroom resource bounding, not a full anti-abuse service or production SLA. The transitive `fast-uri` locks are patched to 3.1.9/4.2.3 within existing dependency ranges in response to the reviewed URI-parsing advisories; no new dependency is introduced.

## Public presentation checklist

1. Open the deployed HTTPS URL ahead of the presentation and wait for the application, not the provider's wake-up/loading page. Create a **new private room** after any service restart or deployment.
2. Open **the same public URL** on the MacBook and phone. Use the deployed room's QR/invitation; do not mix localhost, LAN-IP and public-origin sessions. Public HTTPS uses a normal browser-trusted certificate, so the hosted page does not require installing a mkcert CA on the phone.
3. Keep peers on the same non-isolated Wi-Fi/hotspot, foregrounded, and admit each peer. Verify real Direct WebRTC/Hello readiness, message/ACK, a consented file and Route Pulse. Use `PHYSICAL_DEMO_GUIDE.md` for the four-router diamond and resilience steps.
4. Hosting does **not** guarantee connectivity across arbitrary NATs/firewalls. The current peer configuration has no TURN relay and intentionally remains LAN-first. A public coordinator is not proof of cross-network WebRTC support.
5. Free Render instances can sleep/restart; rooms and coordinator session capabilities are not durable. Recreate the room after an expired-session notice. Tab reload recovery works only while that server still recognizes the session. Free-instance hours/bandwidth/build quotas are shared with the workspace's existing services; this task does not alter its billing plan or spending settings.

## Reproducible verification

Local gate:

```bash
npm ci
npm run check
npm run test:e2e -- --workers=1
npm audit --audit-level=high
```

An explicit public URL runs the live-only gate without launching or accidentally testing a localhost coordinator:

```bash
HOPNET_TEST_URL=https://YOUR_DEPLOYED_HOST npm run test:e2e -- --workers=1 tests/e2e/hosted.spec.ts
```

This gate checks public HTTPS/network metadata/QR origin, authentic host admission and signaling, two actual RTC peers, delivered messaging, accepted signed transfer, independently hashed downloaded bytes and two-way Route Pulse. It captures `/tmp/hopnet-hosted-desktop.png` and `/tmp/hopnet-hosted-mobile.png`. Its two Chrome contexts are automated desktop/phone-sized views on one computer, **not a physical Android/Safari/four-device acceptance pass**. A live provider status or HTTP 200 alone is not this gate.

Official references consulted: [Render web services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket), [default environment variables](https://render.com/docs/environment-variables), [free-service limits](https://render.com/docs/free), [compute plans](https://render.com/docs/compute-plans), [Node versions](https://render.com/docs/node-version). The Markdown fetches were unsupported by the browsing tool; the official HTML references were read instead.
