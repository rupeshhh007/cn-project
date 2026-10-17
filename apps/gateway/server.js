/**
 * SENTINEL / NETWORK LAB — Edge Reverse Proxy & Traffic Mitigation Gateway
 * 
 * Intercepts incoming traffic, derives application-visible behavioral signals,
 * evaluates configurable rate-limiting policies, forwards admitted requests to
 * an independent upstream service, and emits typed events via Server-Sent Events (SSE).
 */

import http from 'http';
import { EventEmitter } from 'events';
import { PolicyModes, DecisionTypes, DecisionReasons, validateDecisionEvent } from '../../packages/contracts/index.js';
import { PolicyEngine } from '../../packages/core/index.js';

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || process.env.PORT, 10) || 8080;
const GATEWAY_HOST = process.env.GATEWAY_HOST || '0.0.0.0';
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://127.0.0.1:8081';
const START_TIME = Date.now();

// Event bus for streaming DecisionEvents to connected UI / test clients
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

// Global metrics
let totalRequests = 0;
let allowedRequests = 0;
let throttledRequests = 0;

// Initialize policy engine
export const policyEngine = new PolicyEngine({
  defaultPolicy: PolicyModes.HYBRID_BEHAVIORAL,
  capacity: 10.0,
  refillRate: 2.0
});

// Upstream URL parsing
const upstreamParsed = new URL(UPSTREAM_URL);

function sendJson(res, statusCode, data, headers = {}) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Demo-IP, X-Simulated-IP, X-Client-ID, X-Telemetry-Battery, X-Telemetry-Charging',
    ...headers
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 32 * 1024) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Actively forwards an allowed HTTP request to the independent upstream backend.
 */
function forwardToUpstream(req, res, targetPath, rawBody, metadata) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    // Prepare clean forward headers
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders.connection;
    delete forwardHeaders['content-length'];

    // Injected gateway provenance headers
    forwardHeaders['x-forwarded-for'] = req.socket.remoteAddress;
    forwardHeaders['x-forwarded-proto'] = 'http';
    forwardHeaders['x-sentinel-request-id'] = metadata.requestId;
    forwardHeaders['x-sentinel-gateway'] = 'sentinel-lab-edge';

    if (rawBody && Buffer.isBuffer(rawBody)) {
      forwardHeaders['content-length'] = rawBody.length;
    }

    const options = {
      hostname: upstreamParsed.hostname,
      port: upstreamParsed.port || 80,
      path: targetPath,
      method: req.method,
      headers: forwardHeaders,
      timeout: 5000
    };

    const upstreamReq = http.request(options, (upstreamRes) => {
      const upstreamLatencyMs = Date.now() - startTime;

      // Copy upstream headers
      const responseHeaders = { ...upstreamRes.headers };
      // Inject Sentinel gateway telemetry headers
      responseHeaders['x-sentinel-decision'] = DecisionTypes.ALLOW;
      responseHeaders['x-sentinel-tokens'] = metadata.tokensRemaining;
      responseHeaders['x-sentinel-cluster'] = metadata.clusterId || 'none';
      responseHeaders['x-sentinel-upstream-latency'] = `${upstreamLatencyMs}ms`;
      responseHeaders['access-control-allow-origin'] = '*';

      res.writeHead(upstreamRes.statusCode, responseHeaders);

      upstreamRes.pipe(res);

      upstreamRes.on('end', () => {
        resolve({
          statusCode: upstreamRes.statusCode,
          latencyMs: upstreamLatencyMs
        });
      });
    });

    upstreamReq.on('error', (err) => {
      console.error('[Gateway] Upstream forwarding error:', err.message);
      sendJson(res, 502, {
        error: 'Bad Gateway: Upstream application unavailable',
        upstream: UPSTREAM_URL,
        message: err.message
      });
      resolve({ statusCode: 502, latencyMs: Date.now() - startTime });
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      sendJson(res, 504, {
        error: 'Gateway Timeout: Upstream application failed to respond in 5000ms'
      });
      resolve({ statusCode: 504, latencyMs: 5000 });
    });

    if (rawBody) {
      upstreamReq.write(rawBody);
    }
    upstreamReq.end();
  });
}

export const server = http.createServer(async (req, res) => {
  const arrivalNs = process.hrtime.bigint();
  totalRequests++;

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Demo-IP, X-Simulated-IP, X-Client-ID, X-Telemetry-Battery, X-Telemetry-Charging'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // 1. Health check endpoint
  if (pathname === '/health' && (method === 'GET' || method === 'HEAD')) {
    if (method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end();
    }
    return sendJson(res, 200, {
      status: 'ok',
      service: 'sentinel-gateway-proxy',
      upstreamTarget: UPSTREAM_URL,
      policyMode: policyEngine.getPolicy(),
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000)
    });
  }

  // 2. Gateway overview API
  if (pathname === '/api/overview' && method === 'GET') {
    return sendJson(res, 200, {
      service: 'sentinel-gateway-proxy',
      policyMode: policyEngine.getPolicy(),
      upstreamTarget: UPSTREAM_URL,
      totalRequests,
      allowedRequests,
      throttledRequests,
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000)
    });
  }

  // 3. Policy configuration API (GET / POST)
  if (pathname === '/api/policy') {
    if (method === 'GET') {
      return sendJson(res, 200, {
        activePolicy: policyEngine.getPolicy(),
        supportedPolicies: Object.values(PolicyModes)
      });
    }
    if (method === 'POST') {
      try {
        const body = await readJsonBody(req);
        if (!body.policyMode || !Object.values(PolicyModes).includes(body.policyMode)) {
          return sendJson(res, 400, {
            error: 'Invalid policyMode',
            supported: Object.values(PolicyModes)
          });
        }
        policyEngine.setPolicy(body.policyMode);
        return sendJson(res, 200, {
          status: 'updated',
          activePolicy: policyEngine.getPolicy()
        });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
  }

  // 4. Reset state API for clean reproducible experiments
  if (pathname === '/api/reset' && method === 'POST') {
    policyEngine.resetState();
    totalRequests = 0;
    allowedRequests = 0;
    throttledRequests = 0;
    return sendJson(res, 200, { status: 'reset_complete' });
  }

  // 5. Server-Sent Events (SSE) Stream
  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(':connected\n\n');

    const listener = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventBus.on('decision', listener);

    const keepAliveTimer = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      eventBus.off('decision', listener);
    });
    return;
  }

  // 6. GENUINE REVERSE PROXY PIPELINE (/protected/*)
  if (pathname.startsWith('/protected')) {
    const targetPath = pathname.replace(/^\/protected/, '') || '/';
    const fullTargetPath = `${targetPath}${parsedUrl.search}`;

    const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const socketRemoteIp = req.socket.remoteAddress || '127.0.0.1';
    
    // Explicitly labeled simulation metadata for controlled scenario benchmarks
    const simulatedSourceIp = req.headers['x-demo-ip'] || req.headers['x-simulated-ip'] || null;
    const clientIdentifier = req.headers['x-client-id'] || 'anonymous';
    
    // Optional self-reported telemetry headers
    let batteryLevel = null;
    if (req.headers['x-telemetry-battery']) {
      const b = parseInt(req.headers['x-telemetry-battery'], 10);
      if (!isNaN(b)) batteryLevel = b;
    }
    const charging = req.headers['x-telemetry-charging'] ? req.headers['x-telemetry-charging'] === 'true' : null;

    // Read incoming request body if POST/PUT
    let rawBody = null;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const chunks = [];
      try {
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        rawBody = Buffer.concat(chunks);
      } catch (err) {
        return sendJson(res, 400, { error: 'Failed to read request body' });
      }
    }

    // Evaluate policy decision
    const evalResult = policyEngine.evaluateRequest({
      socketRemoteIp,
      simulatedSourceIp,
      clientIdentifier,
      batteryLevel,
      charging,
      arrivalNs,
      nowMs: Date.now()
    });

    const isAllowed = evalResult.decision === DecisionTypes.ALLOW;

    if (isAllowed) {
      allowedRequests++;
      // FORWARD TO ACTUAL UPSTREAM BACKEND!
      const forwardResult = await forwardToUpstream(req, res, fullTargetPath, rawBody, {
        requestId,
        tokensRemaining: evalResult.tokensRemaining,
        clusterId: evalResult.clusterId
      });

      // Construct verified DecisionEvent
      const event = validateDecisionEvent({
        eventId: `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        requestId,
        policyMode: evalResult.policyMode,
        decision: DecisionTypes.ALLOW,
        reason: evalResult.reason,
        clientIdentifier,
        socketRemoteIp,
        simulatedSourceIp,
        clusterId: evalResult.clusterId,
        signalConfidence: evalResult.signalConfidence,
        tokensRemaining: evalResult.tokensRemaining,
        tokensCapacity: evalResult.tokensCapacity,
        upstreamForwarded: true,
        upstreamLatencyMs: forwardResult.latencyMs,
        httpStatus: forwardResult.statusCode,
        requestPath: fullTargetPath,
        requestMethod: method
      });

      eventBus.emit('decision', event);
      return;
    } else {
      throttledRequests++;
      // THROTTLE DIRECTLY AT GATEWAY EDGE (Do not bother upstream!)
      res.writeHead(429, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Sentinel-Decision': DecisionTypes.THROTTLE,
        'X-Sentinel-Tokens': evalResult.tokensRemaining,
        'X-Sentinel-Cluster': evalResult.clusterId || 'none',
        'Retry-After': '1',
        'Access-Control-Allow-Origin': '*'
      });

      const responsePayload = JSON.stringify({
        error: 'Too Many Requests',
        message: 'Rate limit quota exhausted for this behavioral observation signature',
        decision: DecisionTypes.THROTTLE,
        policyMode: evalResult.policyMode,
        clusterId: evalResult.clusterId,
        tokensRemaining: evalResult.tokensRemaining,
        retryAfterSeconds: 1
      }, null, 2);

      res.end(responsePayload);

      // Construct verified DecisionEvent for throttled request
      const event = validateDecisionEvent({
        eventId: `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        requestId,
        policyMode: evalResult.policyMode,
        decision: DecisionTypes.THROTTLE,
        reason: evalResult.reason,
        clientIdentifier,
        socketRemoteIp,
        simulatedSourceIp,
        clusterId: evalResult.clusterId,
        signalConfidence: evalResult.signalConfidence,
        tokensRemaining: evalResult.tokensRemaining,
        tokensCapacity: evalResult.tokensCapacity,
        upstreamForwarded: false,
        upstreamLatencyMs: null,
        httpStatus: 429,
        requestPath: fullTargetPath,
        requestMethod: method
      });

      eventBus.emit('decision', event);
      return;
    }
  }

  // Fallback for unmapped routes
  sendJson(res, 404, {
    error: 'Gateway route not found',
    hint: 'Use /protected/* to access proxied upstream routes, /health for health check, or /api/events for SSE stream',
    path: pathname
  });
});

export function startGateway(port = GATEWAY_PORT, host = GATEWAY_HOST) {
  return new Promise((resolve, reject) => {
    server.on('clientError', (err, socket) => {
      console.error('[Gateway] clientError detected:', err.message, err.code);
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
    server.listen(port, host, () => {
      console.log(`[Gateway] Sentinel Reverse Proxy listening on http://${host}:${port}`);
      console.log(`[Gateway] Forwarding protected requests to upstream: ${UPSTREAM_URL}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startGateway().catch(err => {
    console.error('[Gateway] Startup error:', err);
    process.exit(1);
  });
}
