# Cross-Layer Gateway Proxy for Hardware-Fingerprinted Traffic Mitigation

**Academic Prototype — Review 1**  
**Subheading:** Utilizing Application-Visible Request Timing Dynamics and Application-Layer Device Telemetry for Resilient Traffic Mitigation.

---

## 1. Project Title & Scope

**Official Title:** Cross-Layer Gateway Proxy for Hardware-Fingerprinted Traffic Mitigation utilizing Transport-Layer Jitter and Application-Layer Device Telemetry  
**Internal Technical Rigor Definition:** The prototype derives a **probabilistic cross-layer observation signature**, not a permanent physical hardware identifier, using **application-visible request-arrival timing characteristics** and application-layer device telemetry.

---

## 2. Problem Statement

Conventional web application firewalls (WAFs) and API gateways enforce rate limiting primarily keyed on:
1. **Network Layer IP Addresses (L3/L4):** Trivial to circumvent through automated IP rotation (residential proxy networks, cloud VM spinning, TOR, cellular subnet switching, botnets).
2. **Application Layer Session Tokens / Cookies (L7):** Easily cleared, spoofed, or isolated by automated headless scraping scripts.

When an attacker rotates their source IP address on every request while maintaining an identical attack pattern or device source, traditional rate-limiting engines fail completely because each request is treated as a distinct client with a fresh rate-limit quota.

---

## 3. Review-1 Objective

The objective of Review 1 is to build and demonstrate a modular, zero-external-dependency Node.js prototype that:
- Captures high-resolution monotonic request arrival intervals (`process.hrtime.bigint()`).
- Ingests application-layer client telemetry (battery level, charging status).
- Quantizes/normalizes noisy features into coarse buckets to maintain signature stability.
- Synthesizes a deterministic canonical representation hashed via SHA-256 into a pseudonymous observation signature.
- Enforces an in-memory **Token Bucket Rate Limiter** keyed on the cross-layer signature rather than the IP address.
- Proves through simulation (`X-Demo-IP`) that rapid IP rotation fails to bypass mitigation when the underlying cross-layer signature remains identical.

---

## 4. Architecture Overview

```text
HTTP Client Request
        |
        v
  [ proxy-app.js (Raw Node.js HTTP Server) ]
        |
        +---> TimingTracker: High-resolution monotonic timing & rolling statistics (N=20)
        |
        +---> TelemetryStore: In-memory store for client battery and charging status
        |
        +---> SignatureEngine: Normalization, coarse bucketing, deterministic JSON, SHA-256
        |
        +---> RateLimiter (TokenBucket): Keyed by SHA-256 signature (Capacity: 10, Refill: 2/s)
        |
        +---> Decision Gate:
                 |
                 +---> ALLOW    (HTTP 200 OK + remaining tokens)
                 +---> THROTTLE (HTTP 429 Too Many Requests)
```

For detailed architecture diagrams and mathematical formulations, see [`docs/architecture.md`](docs/architecture.md).

---

## 5. How the Prototype Works

1. **Monotonic Timing Feature Extraction:**  
   Every incoming request to `/api/request` captures an arrival timestamp via `process.hrtime.bigint()`. It maintains a rolling circular buffer of the past 20 arrival gaps ($\Delta t$) per logical client and calculates the sample mean ($\mu$), sample variance ($s^2$), and standard deviation ($s$).
2. **Telemetry Ingestion & Graceful Fallback:**  
   The gateway tracks battery percentage and charging state via `/api/telemetry` or inline request bodies. If battery telemetry is unavailable (due to browser security policies), the system gracefully assigns an `unknown` bucket without crashing.
3. **Feature Normalization & Coarse Bucketing:**  
   To prevent hash divergence caused by microsecond jitter, values are bucketed into stable intervals:
   - Battery: 10% buckets (`0, 10, 20, ..., 90`).
   - Timing Average: 20ms buckets.
   - Timing Std Dev: 10ms buckets.
4. **Cryptographic Signature Engine:**  
   The bucketed features are serialized into canonical JSON with lexicographically sorted keys and hashed with SHA-256. A 12-character hexadecimal prefix is displayed in logs and responses.
5. **Per-Signature Token Bucket:**  
   A dedicated token bucket is indexed by the SHA-256 hash:
   - **Capacity:** 10 tokens
   - **Refill Rate:** 2 tokens/sec
   - **Cost:** 1 token/request  
   Requests exceeding the available quota are rejected with HTTP 429 (`RATE_LIMIT_EXCEEDED`).

---

## 6. Current Implementation Details

- **Language & Runtime:** Pure Node.js (v18+).
- **Zero NPM Dependencies:** Employs only standard library modules (`http`, `crypto`, `fs`, `path`, `url`).
- **Memory Safety:** Periodic garbage collection cleans up idle sessions and token buckets after 15 minutes of inactivity (`TTL = 15m`).
- **Stream Backpressure & Payload Limits:** Request bodies exceeding 16 KB trigger stream pausing (`req.pause()`), socket termination (`req.destroy()`), and an HTTP 413 response.

---

## 7. How to Run

### Prerequisites
- Node.js version 18.0.0 or higher.
- Compatible with macOS, Linux, and Windows.

### Start the Gateway Server
```bash
node proxy-app.js
```
The server will start at:
```text
http://localhost:8080/
```

### Run the Automated Load & Mitigation Test
In a separate terminal window:
```bash
node tests/load-test.js
```

---

## 8. API Endpoints Specification

### `GET /`
Serves the interactive web-based monitoring and demonstration dashboard (`client.html`).

### `GET /health`
Returns health check status:
```json
{
  "status": "ok",
  "service": "cross-layer-gateway"
}
```

### `POST /api/telemetry`
Ingests client-side device telemetry.
- **Headers:** `Content-Type: application/json`
- **Body:**
```json
{
  "clientId": "demo-phone-1",
  "batteryLevel": 75,
  "charging": true
}
```
- **Validation:** Battery must be an integer between 0 and 100; charging must be boolean.

### `POST /api/request` (Protected Endpoint)
Protected API endpoint executing the cross-layer signature engine and token bucket rate limiter.
- **Headers:** 
  - `Content-Type: application/json`
  - `X-Demo-IP: 10.0.0.1` *(Optional development simulation header)*
- **Body:**
```json
{
  "clientId": "demo-phone-1",
  "payload": "sample-data"
}
```
- **Response (HTTP 200 ALLOW):**
```json
{
  "allowed": true,
  "signature": "a83f6c9214bd",
  "remainingTokens": 9.0,
  "timing": {
    "sampleCount": 8,
    "averageMs": 21.482,
    "stdDevMs": 3.124
  }
}
```
- **Response (HTTP 429 THROTTLE):**
```json
{
  "allowed": false,
  "reason": "RATE_LIMIT_EXCEEDED",
  "signature": "a83f6c9214bd"
}
```

### `GET /api/stats`
Returns aggregated real-time metrics, global counters, and safe signature summaries.
```json
{
  "totalRequests": 50,
  "allowedRequests": 38,
  "blockedRequests": 12,
  "activeSignatures": 1,
  "uptimeSeconds": 124,
  "signatures": [
    {
      "signature": "a83f6c9214bd",
      "requestCount": 50,
      "allowed": 38,
      "blocked": 12,
      "remainingTokens": 0,
      "lastSeen": "2026-09-23T13:16:00.000Z"
    }
  ]
}
```

---

## 9. Demo Procedure (Step-by-Step for Review 1)

1. **Launch Server:**  
   Execute `node proxy-app.js`. Observe startup banner in the console.
2. **Access Dashboard:**  
   Open `http://localhost:8080/` in your browser.
3. **Inspect Hardware Detection:**  
   Review the Battery API banner. If the browser supports `navigator.getBattery()`, live values populate. If unsupported (e.g. desktop Chrome / Safari restrictions), the fallback message clearly appears:
   `Battery API unavailable — using manually supplied demo telemetry.`
4. **Single Request Flow:**  
   Click **"Send Single Request"**. Inspect the server terminal output to observe the formatted `REQUEST OBSERVED` log block, showing arrival gap, sample count, battery bucket, derived signature, and token balance.
5. **Demonstrate IP-Rotation Evasion Mitigation:**  
   - Keep "Auto-rotate IP during burst" checked.
   - Click **"Send Burst (20 Requests) — Trigger Throttle"**.
   - Notice the live event feed: the burst retains one signature and later requests are throttled (`429 THROTTLE`) despite each request reporting a rotating IP (`10.0.0.1`, `10.0.0.2`, ...). The exact allow/throttle split can vary by one request because the bucket refills continuously during the burst.
6. **Automated Verification:**  
   Run `node tests/load-test.js` to demonstrate reproducible token bucket exhaustion and automatic token refill.

---

## 10. Known Limitations (Explicit Disclosures)

In adherence to academic integrity, the following limitations are formally acknowledged for Review 1:

1. **Network Jitter Skew:** Timing observations are affected by intermediate network hops, bufferbloat, router queuing delay, and OS scheduling latency.
2. **Battery State Instability:** Battery levels continuously discharge or charge, meaning battery telemetry is a dynamic state rather than a permanent hardware identifier.
3. **Browser Telemetry Availability:** The W3C Battery Status API is deprecated or disabled in several browsers due to fingerprinting privacy concerns; fallbacks are required.
4. **Cryptographic Hash Properties:** SHA-256 exhibits the avalanche effect and does not stabilize noisy inputs; stability relies entirely on the upstream bucketing scheme.
5. **Resolution Trade-Off:** Coarse feature bucketing reduces noise divergence but increases collision rates across distinct legitimate devices sharing similar battery levels and request cadences.
6. **Probabilistic Correlation vs. Hardware Identification:** The system demonstrates cross-layer feature correlation, not guaranteed physical silicon identification.
7. **Lack of Kernel-Level TCP Inspection:** Actual packet-level fingerprinting (e.g., TCP initial sequence numbers, window sizing, SYN packet inter-arrival jitter) requires low-level network instrumentation (e.g., eBPF or libpcap), which is outside the scope of raw Node.js application-layer sockets.
8. **Empirical Calibration Needed:** Determining optimal bucket widths, window lengths, and collision probabilities requires rigorous experimental dataset evaluation.

---

## 11. Future Work (Review 2 Roadmap)

- **Kernel/Transport Layer Hooking:** Integrate raw socket sniffing or an eBPF sidecar to extract genuine TCP handshake timestamps and IP ID sequences.
- **Entropy Weighting & Distance Clustering:** Replace rigid deterministic bucketing with continuous metric spaces (e.g., Euclidean distance or Locality-Sensitive Hashing / MinHash) to cluster timing distributions rather than relying on exact SHA-256 matches.
- **Dynamic Adaptive Refill:** Adjust token bucket capacity dynamically based on signature confidence score and request entropy.
