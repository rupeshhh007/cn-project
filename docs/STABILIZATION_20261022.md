# PR #3 stabilization — 22 October 2026

Starting checkpoint: `19531dc`, branch `codex/hopnet-cn-studio`, review target `feat/hopnet-lan`. This is a focused correctness change, not a redesign. No stylesheet, device asset, typography or layout change is included.

## Fixes

1. Verified incoming offers rejected by receiver capacity or assembler preparation now use the same endpoint-signing path as normal decline responses. Reasons are bounded to the wire schema's 160 characters. A received, authenticated decline makes the sender terminal, releases payload buffers and frees its active-transfer slot. If signing/transport is unavailable, notification failure is recorded rather than pretending the sender learned the rejection.
2. Cancellation becomes terminal locally before attempting notification. Missing routes and failed sends do not reject `cancel()`. The UI explicitly warns when the other device may still need cancellation. Outbound buffers/accounting are released; receiver assembly is discarded, including writes that were awaiting a digest. Preparation/hash completion cannot reopen cancelled state. Signed remote cancellation performs the same cleanup.
3. The distributed router owns the message ACK lifecycle instead of a separate React wall-clock timeout. At most 32 messages are pending, with a 30-second monotonic deadline, up to eight send attempts and a 1.5-second retry interval when a local route exists. Retries keep the logical message ID, use a fresh packet ID/sequence, and consult current local forwarding tables. ACK acceptance checks the pending destination, attempted sequence, empty ACK body and deadline. Terminal, unsolicited and expired ACKs cannot turn a failed message into success. Legacy receipts cannot complete distributed messages.

Receiver logical-ID tombstones suppress repeated delivery but permit a fresh ACK for a retry after ACK loss. Different-content reuse is rejected. Sender ID reuse is rejected. Session caches are capped at 4,096 IDs and are not evicted to admit potentially duplicate deliveries; start a fresh room at capacity. These are bounded, in-memory session guarantees, not durable exactly-once delivery across reloads or separately submitted new IDs.

## Regression evidence

Final verification: `npm run check` passed with **56 unit/integration tests**, TypeScript and the production build. `npm run test:e2e -- --workers=1` passed **all eight Chrome flows** in 3.9 minutes. `npm audit --audit-level=high` reported zero vulnerabilities. Execution duration is test-runtime evidence, not a networking benchmark. The pre-existing Vite bundle-size warning remains non-fatal.

Routing was opened in the actual running Chrome app, exercised/exported through the UI, captured and visually inspected at desktop 1440×900 and mobile 390×844. The existing broader responsive test covers all six required sizes. Meaningful page content, controls, typography and layout were present without a framework overlay; the mid-message flow recorded no runtime/console errors. Browser plugin was not available, so the repository Playwright workflow was used. No physical-device pass is claimed.

Unit/integration cases cover authentic capacity declines and repeated sender slot release, authenticated preparation-error declines, route-less sender/receiver cancellation, notification-send failure, cancellation while reading/hashing, lost ACK retries, in-flight relay loss, pending bounds, wrong/late ACK rejection and logical deduplication after packet-cache expiry.

`tests/e2e/message-recovery.spec.ts` uses four real Chrome/WebRTC contexts. It pauses the selected relay's JavaScript through CDP while leaving its RTC channel open, sends the message into that channel, observes pending sender state, then closes the actual relay context. The receiver shows one message and the sender accepts one ACK after a retry through the other relay. No application send/forward/ACK implementation is mocked. This is a controlled stalled-process/browser-failure experiment on one host, not physical LAN failure evidence.

Raw event/route observations: `evidence/message-midflight-recovery.json`. Actual rendered conversation: `screenshots/hopnet-message-recovered.png`. Routing captures are refreshed at the existing six acceptance viewports; desktop `hopnet-routing-1440x900.png` and mobile `hopnet-routing-390x844.png` are visually inspected. Existing signed-file, no-alternate, Lab and Replay tests remain enabled.

An initial browser attempt failed before onboarding because an older coordinator registered the previous hashed assets at startup (`wildcard: false`); rebuilding alone returned HTML at the new JavaScript URL. The exact old development process was stopped and a fresh server registered the new build. That failed attempt is not counted as a successful experiment. Restart the server after production rebuilds; reload all peers for these fixes.

## Remaining risks

Chat ACKs/control-plane reports remain cooperative, not endpoint-signed like file receipts. A failed message means **delivery unconfirmed**, not proof that the receiver never received it. Remote cancellation/decline notification is best effort; a partitioned peer may still require manual cancellation. Browser suspension can delay timers. Existing signed file envelopes remain source-routed. Physical Android/Safari/five-device acceptance and comparative network performance remain unverified.
