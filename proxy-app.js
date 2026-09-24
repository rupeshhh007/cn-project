/**
 * Cross-Layer Gateway Proxy for Hardware-Fingerprinted Traffic Mitigation
 * Academic Review-1 Prototype
 *
 * Implements a probabilistic cross-layer device signature engine combining
 * application-visible request timing features and application-layer device telemetry.
 *
 * Built strictly with Node.js built-in modules: http, crypto, fs, path, url.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Configuration
const PORT = parseInt(process.env.PORT, 10) || 8080;
const MAX_BODY_SIZE = 16 * 1024; // 16 KB payload limit
const STALE_CLEANUP_INTERVAL_MS = 60 * 1000; // GC every 1 minute
const STALE_TTL_MS = 15 * 60 * 1000; // 15 minutes session TTL
const ROLLING_WINDOW_SIZE = 20;

// Token Bucket Rate Limiter defaults
const BUCKET_CAPACITY = 10.0;
const BUCKET_REFILL_RATE = 2.0; // 2 tokens per second
const REQUEST_COST = 1.0;

// Timing Bucketing Constants (coarse intervals to prevent unstable hash divergence)
const TIMING_AVG_BUCKET_MS = 50; // 50ms steps
const TIMING_STDDEV_BUCKET_MS = 50; // 50ms steps
const TIMING_IDLE_GAP_MS = 2000; // Ignore pauses between request sessions

/**
 * TimingTracker
 * Maintains rolling window of high-resolution request arrival intervals per client session.
 * Uses process.hrtime.bigint() for monotonic, sub-millisecond precision.
 * 
 * Note: Measurements reflect application-visible request-arrival timing characteristics,
 * not low-level physical TCP packet jitter.
 */
class TimingTracker {
  constructor(windowSize = ROLLING_WINDOW_SIZE) {
    this.windowSize = windowSize;
    // Map<clientId, { lastTimestampNs: bigint, intervalsMs: number[], lastActiveMs: number }>
    this.clients = new Map();
  }

  /**
   * Records a request and computes statistical timing features.
   * @param {string} clientId 
   * @param {bigint} currentNs 
   * @returns {{ gapMs: number, sampleCount: number, averageMs: number, varianceMs: number, stdDevMs: number }}
   */
  recordRequest(clientId, currentNs) {
    const nowMs = Date.now();
    let client = this.clients.get(clientId);

    if (!client) {
      client = {
        lastTimestampNs: currentNs,
        intervalsMs: [],
        lastActiveMs: nowMs
      };
      this.clients.set(clientId, client);
      return {
        gapMs: 0,
        sampleCount: 0,
        averageMs: 0,
        varianceMs: 0,
        stdDevMs: 0
      };
    }

    // Calculate monotonic arrival gap
    const gapNs = currentNs - client.lastTimestampNs;
    const gapMs = Number(gapNs) / 1_000_000;

    // Update state
    client.lastTimestampNs = currentNs;
    client.lastActiveMs = nowMs;
    // Long idle pauses describe session boundaries, not the active request cadence.
    // Keeping them out of the rolling window prevents one delayed request from
    // churning the observation signature and accidentally creating a fresh bucket.
    if (gapMs <= TIMING_IDLE_GAP_MS) {
      client.intervalsMs.push(gapMs);
    }

    if (client.intervalsMs.length > this.windowSize) {
      client.intervalsMs.shift();
    }

    const n = client.intervalsMs.length;
    if (n === 0) {
      return { gapMs, sampleCount: 0, averageMs: 0, varianceMs: 0, stdDevMs: 0 };
    }

    // Compute sample mean
    const sum = client.intervalsMs.reduce((acc, v) => acc + v, 0);
    const averageMs = sum / n;

    // Compute sample variance & sample standard deviation
    let varianceMs = 0;
    if (n > 1) {
      const sumSqDiff = client.intervalsMs.reduce((acc, v) => acc + Math.pow(v - averageMs, 2), 0);
      varianceMs = sumSqDiff / (n - 1);
    }
    const stdDevMs = Math.sqrt(varianceMs);

    return {
      gapMs: Math.round(gapMs * 1000) / 1000,
      sampleCount: n,
      averageMs: Math.round(averageMs * 1000) / 1000,
      varianceMs: Math.round(varianceMs * 1000) / 1000,
      stdDevMs: Math.round(stdDevMs * 1000) / 1000
    };
  }

  cleanupStale(ttlMs = STALE_TTL_MS) {
    const now = Date.now();
    for (const [clientId, data] of this.clients.entries()) {
      if (now - data.lastActiveMs > ttlMs) {
        this.clients.delete(clientId);
      }
    }
  }
}

/**
 * TelemetryStore
 * In-memory storage for client-reported application device telemetry.
 * Supports missing or incomplete telemetry gracefully.
 */
class TelemetryStore {
  constructor() {
    // Map<clientId, { batteryLevel: number|null, charging: boolean|null, updatedAt: number }>
    this.store = new Map();
  }

  /**
   * Validates and sets telemetry.
   * @param {string} clientId 
   * @param {{ batteryLevel?: number, charging?: boolean }} telemetry 
   */
  setTelemetry(clientId, telemetry) {
    if (!clientId || typeof clientId !== 'string') {
      throw new Error('Invalid or missing clientId');
    }

    let batteryLevel = null;
    if (telemetry.batteryLevel !== undefined && telemetry.batteryLevel !== null) {
      const b = Number(telemetry.batteryLevel);
      if (isNaN(b) || b < 0 || b > 100) {
        throw new Error('Battery level must be a numeric value between 0 and 100');
      }
      batteryLevel = Math.round(b);
    }

    let charging = null;
    if (telemetry.charging !== undefined && telemetry.charging !== null) {
      if (typeof telemetry.charging !== 'boolean') {
        throw new Error('Charging status must be a boolean');
      }
      charging = telemetry.charging;
    }

    this.store.set(clientId, {
      batteryLevel,
      charging,
      updatedAt: Date.now()
    });
  }

  getTelemetry(clientId) {
    return this.store.get(clientId) || { batteryLevel: null, charging: null, updatedAt: 0 };
  }

  cleanupStale(ttlMs = STALE_TTL_MS) {
    const now = Date.now();
    for (const [clientId, data] of this.store.entries()) {
      if (now - data.updatedAt > ttlMs) {
        this.store.delete(clientId);
      }
    }
  }
}

/**
 * SignatureEngine
 * Fuses normalized application-visible request timing features with device telemetry
 * into a canonical representation and computes a deterministic SHA-256 signature.
 * 
 * IMPORTANT: This generates a probabilistic cross-layer observation signature,
 * NOT a permanent physical hardware identifier.
 */
class SignatureEngine {
  /**
   * Normalizes values and generates cryptographic hash.
   * @param {{ batteryLevel: number|null, charging: boolean|null, averageMs: number, stdDevMs: number, sampleCount: number }} features 
   */
  static generateSignature(features) {
    const { batteryLevel, charging, averageMs, stdDevMs, sampleCount } = features;

    // 1. Normalize battery level into coarse buckets (0-9 -> 0, 10-19 -> 10, ..., 90-100 -> 90)
    let batteryBucket = 'unknown';
    if (batteryLevel !== null && batteryLevel !== undefined && !isNaN(batteryLevel)) {
      batteryBucket = Math.min(90, Math.max(0, Math.floor(batteryLevel / 10) * 10));
    }

    // 2. Normalize charging status
    let chargingStatus = 'unknown';
    if (typeof charging === 'boolean') {
      chargingStatus = charging;
    }

    // 3. Normalize timing features (coarse bucketing to avoid hashing jitter noise)
    // Floor-based bins avoid boundary flapping when a burst hovers around the
    // midpoint between two buckets (for example, 24-26ms request spacing).
    const avgIntervalBucket = Math.floor((averageMs || 0) / TIMING_AVG_BUCKET_MS) * TIMING_AVG_BUCKET_MS;
    const stdDevBucket = Math.floor((stdDevMs || 0) / TIMING_STDDEV_BUCKET_MS) * TIMING_STDDEV_BUCKET_MS;

    // 4. Construct canonical representation with deterministic key sorting
    const canonicalFeatures = {
      avgIntervalBucket,
      batteryBucket,
      charging: chargingStatus,
      stdDevBucket
    };

    // Serialize with lexicographical key order
    const canonicalString = JSON.stringify(canonicalFeatures, Object.keys(canonicalFeatures).sort());

    // 5. Generate SHA-256 pseudonymous identifier
    const fullHash = crypto.createHash('sha256').update(canonicalString).digest('hex');
    const displaySignature = fullHash.substring(0, 12);

    return {
      fullHash,
      displaySignature,
      canonicalFeatures,
      canonicalString
    };
  }
}

/**
 * TokenBucket
 * Represents an in-memory token bucket instance bound to a specific cross-layer signature.
 */
class TokenBucket {
  constructor(capacity = BUCKET_CAPACITY, refillRate = BUCKET_REFILL_RATE) {
    this.capacity = capacity;
    this.refillRate = refillRate; // tokens per second
    this.tokens = capacity;
    this.lastRefillTimestamp = Date.now();
    this.allowedRequests = 0;
    this.blockedRequests = 0;
    this.totalRequests = 0;
    this.firstSeen = Date.now();
    this.lastSeen = Date.now();
  }

  refill(nowMs = Date.now()) {
    const elapsedSeconds = (nowMs - this.lastRefillTimestamp) / 1000;
    if (elapsedSeconds > 0) {
      const addedTokens = elapsedSeconds * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + addedTokens);
      this.lastRefillTimestamp = nowMs;
    }
  }

  tryConsume(cost = REQUEST_COST, nowMs = Date.now()) {
    this.refill(nowMs);
    this.totalRequests++;
    this.lastSeen = nowMs;

    if (this.tokens >= cost) {
      this.tokens -= cost;
      this.allowedRequests++;
      return {
        allowed: true,
        remainingTokens: Math.round(this.tokens * 100) / 100
      };
    } else {
      this.blockedRequests++;
      return {
        allowed: false,
        remainingTokens: Math.round(this.tokens * 100) / 100
      };
    }
  }
}

/**
 * RateLimiter
 * Manages TokenBuckets indexed by cross-layer SHA-256 signature (NOT by IP address).
 */
class RateLimiter {
  constructor(capacity = BUCKET_CAPACITY, refillRate = BUCKET_REFILL_RATE) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    // Map<signature, TokenBucket>
    this.buckets = new Map();
  }

  /**
   * Evaluates request against the token bucket keyed by signature.
   * @param {string} signature 
   * @param {number} cost 
   * @returns {{ allowed: boolean, remainingTokens: number, bucket: TokenBucket }}
   */
  process(signature, cost = REQUEST_COST) {
    let bucket = this.buckets.get(signature);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillRate);
      this.buckets.set(signature, bucket);
    }

    const result = bucket.tryConsume(cost);
    return {
      ...result,
      bucket
    };
  }

  cleanupStale(ttlMs = STALE_TTL_MS) {
    const now = Date.now();
    for (const [signature, bucket] of this.buckets.entries()) {
      if (now - bucket.lastSeen > ttlMs) {
        this.buckets.delete(signature);
      }
    }
  }

  getActiveCount() {
    return this.buckets.size;
  }

  getSafeSummaries() {
    const summaries = [];
    for (const [signature, bucket] of this.buckets.entries()) {
      summaries.push({
        signature: signature.substring(0, 12),
        requestCount: bucket.totalRequests,
        allowed: bucket.allowedRequests,
        blocked: bucket.blockedRequests,
        remainingTokens: Math.round(bucket.tokens * 100) / 100,
        lastSeen: new Date(bucket.lastSeen).toISOString()
      });
    }
    return summaries;
  }
}

/**
 * StatsTracker
 * Tracks aggregated statistics across the gateway lifetime.
 */
class StatsTracker {
  constructor() {
    this.totalRequests = 0;
    this.allowedRequests = 0;
    this.blockedRequests = 0;
    this.startTime = Date.now();
  }

  record(allowed) {
    this.totalRequests++;
    if (allowed) {
      this.allowedRequests++;
    } else {
      this.blockedRequests++;
    }
  }

  getSnapshot(rateLimiter) {
    return {
      totalRequests: this.totalRequests,
      allowedRequests: this.allowedRequests,
      blockedRequests: this.blockedRequests,
      activeSignatures: rateLimiter.getActiveCount(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      signatures: rateLimiter.getSafeSummaries()
    };
  }
}

// Instantiate core subsystems
const timingTracker = new TimingTracker();
const telemetryStore = new TelemetryStore();
const rateLimiter = new RateLimiter();
const statsTracker = new StatsTracker();

// Periodic GC for in-memory structures to guarantee bounded memory usage
setInterval(() => {
  timingTracker.cleanupStale();
  telemetryStore.cleanupStale();
  rateLimiter.cleanupStale();
}, STALE_CLEANUP_INTERVAL_MS).unref();

/**
 * Helper: Read request body with size check and backpressure handling.
 * Explaining stream backpressure:
 * Node.js Readable streams buffer incoming chunks. If the received bytes exceed
 * MAX_BODY_SIZE, we pause the stream (stream.pause()) to halt incoming data chunks,
 * reject the request with HTTP 413, and destroy the socket.
 */
function readJsonBody(req, maxBytes = MAX_BODY_SIZE) {
  return new Promise((resolve, reject) => {
    let bytesReceived = 0;
    const chunks = [];

    function onData(chunk) {
      bytesReceived += chunk.length;
      if (bytesReceived > maxBytes) {
        req.pause();
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        const err = new Error('PAYLOAD_TOO_LARGE');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (err) {
        const parseErr = new Error('MALFORMED_JSON');
        parseErr.statusCode = 400;
        parseErr.details = err.message;
        reject(parseErr);
      }
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', (err) => reject(err));
  });
}

/**
 * Helper: Sends standardized JSON responses with CORS headers.
 */
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Demo-IP'
  });
  res.end(payload);
}

/**
 * Helper: Formats and logs request telemetry to stdout.
 */
function logRequestDecision(details) {
  const lines = [
    '==================================================',
    'REQUEST OBSERVED',
    `Client ID       : ${details.clientId}`,
    `Remote IP       : ${details.remoteIp}`,
  ];

  if (details.simulatedIp) {
    lines.push(`Simulated IP    : ${details.simulatedIp} (via X-Demo-IP simulation)`);
  }

  lines.push(
    `Arrival Gap     : ${details.gapMs.toFixed(3)} ms`,
    `Timing Samples  : ${details.sampleCount}`,
    `Average Gap     : ${details.averageMs.toFixed(3)} ms`,
    `Std Deviation   : ${details.stdDevMs.toFixed(3)} ms`,
    `Battery         : ${details.batteryStr}`,
    `Charging        : ${details.chargingStr}`,
    `Signature       : ${details.displaySignature}`,
    `Tokens          : ${details.remainingTokens.toFixed(2)} / ${BUCKET_CAPACITY}`,
    `Decision        : ${details.allowed ? 'ALLOW' : 'THROTTLE'}`,
    `HTTP Status     : ${details.allowed ? 200 : 429}`,
    '=================================================='
  );

  console.log(lines.join('\n'));
}

/**
 * Main HTTP Request Handler
 */
const server = http.createServer(async (req, res) => {
  // CORS Preflight handling
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Demo-IP'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, 'http://localhost');
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // 1. GET / -> Serve client.html
  if (method === 'GET' && pathname === '/') {
    const clientPath = path.join(__dirname, 'client.html');
    fs.readFile(clientPath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error: Unable to load client.html');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(content)
      });
      res.end(content);
    });
    return;
  }

  // 2. GET /health -> Service health status
  if (method === 'GET' && pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'cross-layer-gateway'
    });
    return;
  }

  // 3. GET /api/stats -> Gateway telemetry & signature statistics
  if (method === 'GET' && pathname === '/api/stats') {
    const stats = statsTracker.getSnapshot(rateLimiter);
    sendJson(res, 200, stats);
    return;
  }

  // 4. POST /api/telemetry -> Ingest client device telemetry
  if (method === 'POST' && pathname === '/api/telemetry') {
    // Validate Content-Type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      sendJson(res, 415, { error: 'Unsupported Media Type: expected application/json' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      if (!body.clientId) {
        sendJson(res, 400, { error: 'Missing required field: clientId' });
        return;
      }

      telemetryStore.setTelemetry(body.clientId, {
        batteryLevel: body.batteryLevel,
        charging: body.charging
      });

      sendJson(res, 200, {
        status: 'accepted',
        clientId: body.clientId,
        telemetry: telemetryStore.getTelemetry(body.clientId)
      });
    } catch (err) {
      if (err.statusCode) {
        sendJson(res, err.statusCode, { error: err.message, details: err.details });
      } else {
        sendJson(res, 400, { error: err.message });
      }
    }
    return;
  }

  // 5. POST /api/request -> Protected endpoint evaluating cross-layer signature
  if (method === 'POST' && pathname === '/api/request') {
    // Capture high-resolution monotonic arrival timestamp immediately
    const arrivalNs = process.hrtime.bigint();

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      sendJson(res, 415, { error: 'Unsupported Media Type: expected application/json' });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const clientId = body.clientId || 'anonymous-client';

      // Record request arrival timing features
      const timing = timingTracker.recordRequest(clientId, arrivalNs);

      // Ingest telemetry if supplied directly with the request or retrieve cached telemetry
      if (body.batteryLevel !== undefined || body.charging !== undefined) {
        try {
          telemetryStore.setTelemetry(clientId, {
            batteryLevel: body.batteryLevel,
            charging: body.charging
          });
        } catch (_) {
          // Keep existing telemetry if inline telemetry is partial or invalid
        }
      }
      const telemetry = telemetryStore.getTelemetry(clientId);

      // Generate probabilistic cross-layer observation signature
      const sigData = SignatureEngine.generateSignature({
        batteryLevel: telemetry.batteryLevel,
        charging: telemetry.charging,
        averageMs: timing.averageMs,
        stdDevMs: timing.stdDevMs,
        sampleCount: timing.sampleCount
      });

      // Rate limit check keyed on the SHA-256 signature (NOT client IP)
      const limitResult = rateLimiter.process(sigData.fullHash, REQUEST_COST);

      // Record global metrics
      statsTracker.record(limitResult.allowed);

      // Prepare log information
      const remoteIp = req.socket.remoteAddress || 'unknown';
      const simulatedIp = req.headers['x-demo-ip'] || null;
      const batteryStr = telemetry.batteryLevel !== null ? `${telemetry.batteryLevel}%` : 'UNAVAILABLE';
      const chargingStr = telemetry.charging !== null ? (telemetry.charging ? 'YES' : 'NO') : 'UNAVAILABLE';

      logRequestDecision({
        clientId,
        remoteIp,
        simulatedIp,
        gapMs: timing.gapMs,
        sampleCount: timing.sampleCount,
        averageMs: timing.averageMs,
        stdDevMs: timing.stdDevMs,
        batteryStr,
        chargingStr,
        displaySignature: sigData.displaySignature,
        remainingTokens: limitResult.remainingTokens,
        allowed: limitResult.allowed
      });

      // Dispatch response
      if (limitResult.allowed) {
        sendJson(res, 200, {
          allowed: true,
          signature: sigData.displaySignature,
          remainingTokens: limitResult.remainingTokens,
          timing: {
            sampleCount: timing.sampleCount,
            averageMs: timing.averageMs,
            stdDevMs: timing.stdDevMs
          }
        });
      } else {
        sendJson(res, 429, {
          allowed: false,
          reason: 'RATE_LIMIT_EXCEEDED',
          signature: sigData.displaySignature
        });
      }
    } catch (err) {
      if (err.statusCode) {
        sendJson(res, err.statusCode, { error: err.message, details: err.details });
      } else {
        sendJson(res, 500, { error: 'Internal Server Error', details: err.message });
      }
    }
    return;
  }

  // Fallback 404 for unknown endpoints
  sendJson(res, 404, {
    error: 'NOT_FOUND',
    message: `Cannot ${method} ${pathname}`
  });
});

// Start listening only when launched directly. Tests can require the server
// without opening a real network socket.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log('================================================================');
    console.log(' Cross-Layer Gateway Proxy Server (Review-1 Academic Prototype)');
    console.log('================================================================');
    console.log(` Server running at: http://localhost:${PORT}/`);
    console.log(` Environment      : Node.js ${process.version}`);
    console.log(` Endpoints:`);
    console.log(`   GET  /               -> Interactive Web Dashboard (client.html)`);
    console.log(`   GET  /health         -> Health Check JSON`);
    console.log(`   GET  /api/stats      -> Live Gateway Metrics`);
    console.log(`   POST /api/telemetry  -> Ingest Client Device Telemetry`);
    console.log(`   POST /api/request    -> Protected Endpoint (Signature & Token Bucket)`);
    console.log('================================================================\n');
  });
}

// Export server instance for testing
module.exports = server;
module.exports.TimingTracker = TimingTracker;
module.exports.SignatureEngine = SignatureEngine;
