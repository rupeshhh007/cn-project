# SENTINEL / NETWORK LAB — Product & Engineering Specification

## 1. Executive Summary & Thesis
**SENTINEL / NETWORK LAB** is an explainable network traffic defense workbench and interactive security experimentation laboratory. It addresses the fundamental flaw of conventional L3/L4 rate-limiting systems: the inability to detect automated traffic rotating source IP addresses or spoofing session tokens.

Rather than claiming to identify silicon hardware through application-layer observations, Sentinel derives **probabilistic behavioral observation signatures** combining transport-influenced arrival jitter and optional client telemetry, evaluating requests against distinct rate-limiting policies and forwarding permitted traffic to an independent upstream service.

---

## 2. Core Scientific & Technical Tenets
1. **Honest Terminology:**
   - Signatures are *probabilistic observation signatures* or *behavioral clusters*, **never** permanent physical hardware fingerprints.
   - SHA-256 serves as an exact deterministic digest of normalized feature inputs; it is an identifier, not a classifier.
   - Timing measurements are application-visible arrival timestamps (`process.hrtime.bigint()`), not kernel TCP SYN/ACK packet capture.
2. **Reverse Proxy Forwarding:**
   - The gateway is a genuine HTTP reverse proxy. Permitted traffic is actively streamed to a distinct upstream application service; rejected traffic is throttled at the gateway edge with HTTP 429.
3. **Untrusted Client Inputs:**
   - `X-Demo-IP` is strictly labeled simulation metadata for controlled scenario evaluation.
   - Real network identification uses `req.socket.remoteAddress`.
   - Battery telemetry and client identifiers are treated as untrusted, self-reported optional inputs with explicit privacy/browser limitations.
4. **Transparent Trade-offs & Failure Disclosure:**
   - The laboratory explicitly demonstrates scenarios where behavioral defense succeeds (defeating IP rotation) and where it struggles or fails (NAT client collisions, deliberate cadence imitation/jitter perturbation).

---

## 3. System Architecture & Monorepo Structure

```
cn-project/
├── apps/
│   ├── gateway/         # Real HTTP reverse proxy, policy engine, SSE event stream
│   ├── upstream/        # Independent upstream API service (mock application backend)
│   └── web/             # Interactive React + Vite + TypeScript 3D Network Laboratory
├── packages/
│   ├── contracts/       # Shared TypeScript DTOs, decision event schemas, experiment types
│   └── core/            # Sliding window statistics, online clustering, token bucket state machine
├── scripts/
│   └── scenarios/       # 5 deterministic, seed-based local traffic generator scripts
├── legacy/
│   └── review1/         # Preserved Review-1 standalone prototype & test suite
├── docs/                # Architectural diagrams, methodology, experiment reports
└── reports/             # Exported JSON/CSV benchmark data
```

---

## 4. Policy Modes Under Comparison
Sentinel provides three configurable rate-limiting policies evaluated on identical workloads:

1. **Policy A — Per-Source-IP Token Bucket (Conventional Baseline):**
   - Rates tracked solely by client socket remote IP (or simulated IP in controlled benchmarks).
   - Vulnerable to IP rotation; penalizes multiple legitimate clients sharing a single NAT gateway.
2. **Policy B — Per-Session Identifier Baseline:**
   - Rates tracked by explicit client token / session header.
   - Honestly labeled as spoofable (trivial for scrapers to rotate cookies/IDs).
3. **Policy C — Experimental Hybrid Behavioral Policy:**
   - Computes rolling inter-arrival statistics ($\mu, \sigma, CV$), burstiness, and path entropy over a window of $N=20$.
   - Applies soft distance clustering and confidence scoring.
   - Includes safety fallbacks to IP baseline during cold-start or low confidence.

---

## 5. Five Reproducible Local Experiments
1. **Scenario 1 — Legitimate Human Traffic:** Spaced requests from multiple devices; demonstrates low false positives and steady token replenishment.
2. **Scenario 2 — Scripted IP Rotation Attack:** High-frequency attack rotating source IPs across requests; demonstrates failure of Policy A and mitigation by Policy C.
3. **Scenario 3 — Shared IP / NAT Multi-Client Fairness:** Multiple distinct legitimate clients sharing one external IP; demonstrates collateral damage under Policy A and preservation under Policy C.
4. **Scenario 4 — Rapid Burst & Bucket Recovery:** High-rate burst exhausting bucket capacity ($C=10$), demonstrating time-based refill ($r=2.0\text{ s}^{-1}$).
5. **Scenario 5 — Cadence Jitter Evasion & Boundary Limits:** Attack modifying inter-arrival pacing to evade bucketing; explicitly demonstrates signature drift and boundaries of behavioral correlation.

---

## 6. Visual Design & 3D Spatial Laboratory Specification
- **Art Direction:** Industrial graphite (`#0b0f17`), crisp editorial typography (`Space Grotesk`, `JetBrains Mono`), acid-lime signals (`#10b981` / `#a3e635`), warm salmon attack alerts (`#f87171` / `#fb7185`).
- **Central 3D Scene (`@react-three/fiber`):**
  - Interactive low-poly models: Developer Laptop, Rotating Phone, IoT Sensor, Sentinel Edge Gateway, Upstream Application Server Rack.
  - Orthographic perspective, bounded orbit controls, animated packet flow with distinct particle paths for ALLOW (green to server) and THROTTLE (salmon pulse terminating at gateway).
- **Contextual Inspector:**
  - Selecting any 3D device opens an inspector drawer with real-time telemetry, confidence scores, policy metrics, and packet logs.
- **Accessible 2D Topology Fallback:**
  - Full functional parity for devices with reduced motion or when WebGL is unavailable.

---

## 7. Milestone Roadmap
- **Milestone 1:** First Complete Vertical Slice (Client -> Real Reverse Proxy -> Separate Upstream -> Decision Event Stream -> Passing Tests).
- **Milestone 2:** Core Signal Engine, Three Policy Modes, and 5 Automated Benchmark Scenarios with deterministic seeding.
- **Milestone 3:** React + Vite + TypeScript Frontend with 3D Spatial Lab (R3F) and 2D topology fallback.
- **Milestone 4:** Policy Comparison Studio, Scrubber Timeline, CSV/JSON Report Exports, and Final Academic Documentation.
