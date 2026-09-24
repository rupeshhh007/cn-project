# Architecture Specification: Cross-Layer Gateway Proxy

**Academic Project Review 1**  
**Title:** Cross-Layer Gateway Proxy for Hardware-Fingerprinted Traffic Mitigation utilizing Transport-Layer Jitter and Application-Layer Device Telemetry  
**Internal Terminology:** *Probabilistic Cross-Layer Observation Signature Engine*

---

## 1. System Overview & Architecture Diagram

The gateway is built as a zero-dependency, raw Node.js proxy service designed to mitigate malicious or automated traffic that attempts to circumvent traditional rate-limiting (e.g., via IP rotation or session token wiping).

Instead of relying solely on Network Layer 3/4 headers or Application Layer session cookies, the gateway synthesizes a **probabilistic cross-layer observation signature** by combining:
1. **Application-visible request arrival timing characteristics** (high-resolution arrival gaps, sample variance, standard deviation).
2. **Application-layer device telemetry** (battery percentage, charging status).

### End-to-End Request Pipeline

```text
                  +-----------------------------------+
                  |         HTTP Client / Bot         |
                  +-----------------------------------+
                                    |
                                    | HTTP POST /api/request
                                    | (Headers: X-Demo-IP [Simulation])
                                    v
     ===================================================================
     |                      RAW NODE.JS GATEWAY                        |
     ===================================================================
     |                                                                 |
     |   [1] Stream Receiver & Backpressure Validator                  |
     |       - Payload limit verification (< 16 KB)                    |
     |       - Content-Type: application/json                          |
     |                                                                 |
     |   [2] Monotonic Timestamp Capture                               |
     |       - process.hrtime.bigint() (Sub-microsecond resolution)    |
     |                                                                 |
     |        +-----------------------------------------------+        |
     |        |                                               |        |
     |        v                                               v        |
     |   +--------------------------+    +-------------------------+   |
     |   |   TimingTracker (L4/L7)  |    |   TelemetryStore (L7)   |   |
     |   |--------------------------|    |-------------------------|   |
     |   | - Rolling window (N=20)  |    | - Battery Level (%)     |   |
     |   | - Arrival Gap (Δt)       |    | - Charging (Boolean)    |   |
     |   | - Sample Mean (μ)        |    | - Graceful fallback     |   |
     |   | - Standard Deviation (σ) |    |   if API unavailable    |   |
     |   +--------------------------+    +-------------------------+   |
     |        |                                               |        |
     |        +-----------------------+-----------------------+        |
     |                                |                                |
     |                                v                                |
     |   [3] Feature Normalization & Quantization Engine               |
     |       - Coarse Battery Bucketing: Math.floor(L / 10) * 10       |
     |       - Ignore idle gaps greater than 2 seconds                 |
     |       - Coarse Timing Avg Bucketing: floor(μ / 50) * 50         |
     |       - Coarse Timing StdDev Bucketing: floor(σ / 50) * 50      |
     |                                                                 |
     |                                v                                |
     |   [4] Deterministic Canonical Serialization                     |
     |       - Lexicographically sorted JSON keys                      |
     |                                                                 |
     |                                v                                |
     |   [5] Cryptographic Signature Engine                            |
     |       - crypto.createHash("sha256")                             |
     |       - Digest: Full 64-char Hex (Internally maintained)        |
     |       - Truncated 12-char Hex display signature                 |
     |                                                                 |
     |                                v                                |
     |   [6] Token Bucket Rate Limiter (Keyed by Signature)            |
     |       - Capacity: 10 Tokens                                     |
     |       - Refill Rate: 2 Tokens / Second                          |
     |       - Cost: 1 Token / Request                                 |
     |                                                                 |
     ===================================================================
                                      |
                     +----------------+----------------+
                     |                                 |
                     v                                 v
          [ Tokens >= 1.0 ]                     [ Tokens < 1.0 ]
                 |                                     |
                 v                                     v
         HTTP 200 ALLOW                       HTTP 429 TOO MANY REQUESTS
         - remainingTokens                    - reason: RATE_LIMIT_EXCEEDED
         - signature                          - signature
         - timing analytics
```

---

## 2. Conceptual Identity Taxonomy

A central contribution of this academic prototype is distinguishing between different levels of network identity. Attackers frequently exploit the decoupling between these layers:

| Identity Layer | Conceptual Representation | Typical Evasion Technique | Prototype Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **IP Identity** | Layer 3/4 Source Address (`127.0.0.1`, `198.51.100.4`) | Proxy networks, TOR, IPv6 pool rotation, botnet zombie hopping | **Decoupled:** Gateway rate limits do *not* key on IP address. Rotating IPs with identical cross-layer features land in the exact same token bucket. |
| **Client / Session Identity** | Layer 7 Application State (Session cookies, JWT, UUID) | Cookie clearing, incognito mode, headless browser restarts | **Correlated:** Evaluates behavioral timing and device physical indicators rather than trusting user-provided session headers. |
| **Cross-Layer Observation Signature** | Statistical fusion of coarse timing dynamics and device telemetry (SHA-256 hash) | Intentional jitter induction, spoofing (costly to automate consistently) | **Primary Target (Review 1):** Groups requests based on quantized probabilistic behavioral and telemetry features. |
| **Physical Hardware Identity** | True silicon-level physical characteristics (Clock skew, DAC/ADC quirks, RF leakage) | Physically swapping or flashing hardware | **Theoretical Limit:** Full physical hardware fingerprinting requires low-level kernel/packet instrumentation (e.g. TCP SYN timestamps, eBPF, NIC PHY analysis), deferred to future research. |

---

## 3. Mathematical Formulation of Timing Features

### High-Resolution Monotonic Sampling
Request timestamps are obtained via Node.js `process.hrtime.bigint()`, which queries the platform's high-resolution monotonic clock:
$$\Delta t_k = \frac{t_k - t_{k-1}}{10^6} \quad (\text{milliseconds})$$
Monotonic clocks guarantee non-decreasing time values unaffected by NTP clock skew or system time updates.

### Rolling Window Statistics
For a sliding window of the latest $N$ request arrival intervals ($N \le 20$):

1. **Sample Mean (Average Interval):**
   $$\mu = \frac{1}{N} \sum_{i=1}^N \Delta t_i$$

2. **Sample Variance ($s^2$):**
   $$s^2 = \frac{1}{N - 1} \sum_{i=1}^N (\Delta t_i - \mu)^2 \quad (\text{for } N > 1)$$

3. **Sample Standard Deviation ($s$):**
   $$s = \sqrt{s^2}$$

### Normalization and Coarse Bucketing Rationale
Cryptographic hash functions like SHA-256 have the **avalanche effect**: a 1-nanosecond difference in raw timing would generate a completely unrelated digest.

To yield a usable, stable signature from noisy measurements:
- **Battery Bucket:** Quantized into 10% bins:
  $$B_{\text{bucket}} = \min\left(90, \max\left(0, \left\lfloor \frac{\text{batteryLevel}}{10} \right\rfloor \times 10\right)\right)$$
- **Idle-gap filtering:** Intervals above 2 seconds mark a pause between active request sessions and are excluded from the cadence window. This prevents a single idle period from churning the signature and allocating a fresh rate-limit bucket.
- **Average Timing Bucket:** Quantized into floor-based 50ms bins:
  $$T_{\text{avg\_bucket}} = \text{floor}\left(\frac{\mu}{50}\right) \times 50$$
- **Standard Deviation Bucket:** Quantized into floor-based 50ms bins:
  $$T_{\text{std\_bucket}} = \text{floor}\left(\frac{s}{50}\right) \times 50$$

Floor-based bins keep a rapid cadence stable when ordinary scheduling jitter moves an interval across the midpoint between two buckets.

---

## 4. Token Bucket Algorithm & State Machine

Each unique cross-layer signature $S$ maps to an isolated `TokenBucket` instance:

```text
State:
  capacity: 10.0
  refillRate: 2.0 tokens/second
  tokens: current balance in [0.0, 10.0]
  lastRefillTimestamp: t_last
```

### Transition Equations
When a request arrives at timestamp $t_{\text{now}}$:
$$\Delta t = \frac{t_{\text{now}} - t_{\text{last}}}{1000} \quad (\text{seconds})$$
$$\text{tokens} \leftarrow \min(\text{capacity}, \text{tokens} + \Delta t \times \text{refillRate})$$
$$t_{\text{last}} \leftarrow t_{\text{now}}$$

$$\text{Decision} = \begin{cases} 
\text{ALLOW (HTTP 200)}, & \text{if tokens} \ge 1.0 \quad (\text{tokens} \leftarrow \text{tokens} - 1.0) \\
\text{THROTTLE (HTTP 429)}, & \text{if tokens} < 1.0 
\end{cases}$$

---

## 5. Memory Management & Bounded Resource Guarantees

In-memory gateways run the risk of state exhaustion (DoS via signature explosion). To guarantee memory bounds:
- **Session Eviction:** Inactive client sessions and idle signature buckets are purged after an inactivity threshold ($TTL = 15 \text{ minutes}$).
- **Streaming Guardrails:** Incoming HTTP requests are monitored chunk-by-chunk. If the accumulated payload exceeds $16 \text{ KB}$, the stream is immediately paused (`req.pause()`), rejected with HTTP 413, and the socket destroyed (`req.destroy()`).
