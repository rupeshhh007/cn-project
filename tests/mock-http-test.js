/**
 * In-Memory HTTP Route & Pipeline Integration Test
 * Simulates HTTP requests and responses directly through the server handler
 * without opening network sockets, verifying the full HTTP pipeline in sandbox.
 */

const { EventEmitter } = require('events');
const assert = require('assert');

// Mock request
class MockReq extends EventEmitter {
  constructor({ method, url, headers = {}, body = null }) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = body;
    this.socket = { remoteAddress: '127.0.0.1' };
  }

  start() {
    process.nextTick(() => {
      if (this.body) {
        const buf = Buffer.from(typeof this.body === 'string' ? this.body : JSON.stringify(this.body));
        this.emit('data', buf);
      }
      this.emit('end');
    });
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }
  destroy() { this.destroyed = true; }
}

// Mock response
class MockRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.bodyChunks = [];
    this.finished = false;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
  }

  setHeader(k, v) {
    this.headers[k] = v;
  }

  write(chunk) {
    if (chunk) this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  end(chunk) {
    if (chunk) this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.finished = true;
    this.emit('finish');
  }

  get body() {
    const raw = Buffer.concat(this.bodyChunks).toString('utf8');
    try {
      return JSON.parse(raw);
    } catch (_) {
      return raw;
    }
  }
}

async function dispatch(server, options) {
  const req = new MockReq(options);
  const res = new MockRes();

  return new Promise((resolve) => {
    res.on('finish', () => {
      resolve({ statusCode: res.statusCode, headers: res.headers, body: res.body });
    });
    // server is an http.Server; its request listener is registered for 'request'
    server.emit('request', req, res);
    req.start();
  });
}

async function runMockTests() {
  console.log('Testing HTTP Endpoints & Pipeline via Mock Harness...');
  const server = require('../proxy-app.js');

  // Test 1: GET /health
  const rHealth = await dispatch(server, { method: 'GET', url: '/health' });
  assert.strictEqual(rHealth.statusCode, 200);
  assert.strictEqual(rHealth.body.status, 'ok');
  assert.strictEqual(rHealth.body.service, 'cross-layer-gateway');
  console.log('✓ GET /health verified.');

  // Test 2: GET / (client.html)
  const rRoot = await dispatch(server, { method: 'GET', url: '/' });
  assert.strictEqual(rRoot.statusCode, 200);
  assert(rRoot.headers['Content-Type'].includes('text/html'));
  assert(rRoot.body.includes('Cross-Layer Gateway'));
  assert(rRoot.body.includes('Network observation console'));
  console.log('✓ GET / (client.html) verified.');

  // Test 3: POST /api/telemetry (Invalid Content-Type)
  const rTelemBadCT = await dispatch(server, {
    method: 'POST',
    url: '/api/telemetry',
    headers: { 'content-type': 'text/plain' },
    body: 'plain'
  });
  assert.strictEqual(rTelemBadCT.statusCode, 415);
  console.log('✓ Content-Type validation (415) verified.');

  // Test 4: POST /api/telemetry (Valid JSON)
  const rTelem = await dispatch(server, {
    method: 'POST',
    url: '/api/telemetry',
    headers: { 'content-type': 'application/json' },
    body: { clientId: 'test-mock-client', batteryLevel: 80, charging: true }
  });
  assert.strictEqual(rTelem.statusCode, 200);
  assert.strictEqual(rTelem.body.status, 'accepted');
  assert.strictEqual(rTelem.body.telemetry.batteryLevel, 80);
  console.log('✓ POST /api/telemetry verified.');

  // Test 5: POST /api/telemetry (Invalid Battery)
  const rTelemBad = await dispatch(server, {
    method: 'POST',
    url: '/api/telemetry',
    headers: { 'content-type': 'application/json' },
    body: { clientId: 'test-mock-client', batteryLevel: 150 }
  });
  assert.strictEqual(rTelemBad.statusCode, 400);
  console.log('✓ Telemetry validation rejection (400) verified.');

  // Test 6: Rate Limiting & Token Bucket on POST /api/request
  console.log('Sending burst of 12 requests with rotating simulated IPs...');
  let allowed = 0;
  let blocked = 0;

  for (let i = 1; i <= 12; i++) {
    const rReq = await dispatch(server, {
      method: 'POST',
      url: '/api/request',
      headers: {
        'content-type': 'application/json',
        'x-demo-ip': `10.0.0.${i}`
      },
      body: { clientId: 'test-mock-client', payload: `burst-${i}` }
    });

    if (rReq.statusCode === 200 && rReq.body.allowed) {
      allowed++;
    } else if (rReq.statusCode === 429) {
      blocked++;
      assert.strictEqual(rReq.body.reason, 'RATE_LIMIT_EXCEEDED');
    }
  }

  assert.strictEqual(allowed, 10, 'First 10 requests must be allowed');
  assert.strictEqual(blocked, 2, 'Requests 11 & 12 must be throttled with HTTP 429');
  console.log('✓ Token Bucket & Signature Keying across rotating IPs verified (10 Allowed, 2 Throttled).');

  // Test 7: GET /api/stats
  const rStats = await dispatch(server, { method: 'GET', url: '/api/stats' });
  assert.strictEqual(rStats.statusCode, 200);
  assert(rStats.body.totalRequests >= 12);
  assert(rStats.body.allowedRequests >= 10);
  assert(rStats.body.blockedRequests >= 2);
  console.log('✓ GET /api/stats snapshot verified.');

  // Test 8: 404 Not Found
  const r404 = await dispatch(server, { method: 'GET', url: '/unknown-route' });
  assert.strictEqual(r404.statusCode, 404);
  console.log('✓ 404 Handler verified.');

  // Test 9: Payload size limit (>16KB)
  const hugeString = 'a'.repeat(20 * 1024);
  const rHuge = await dispatch(server, {
    method: 'POST',
    url: '/api/request',
    headers: { 'content-type': 'application/json' },
    body: { clientId: 'test-mock-client', payload: hugeString }
  });
  assert.strictEqual(rHuge.statusCode, 413);
  console.log('✓ 16KB Payload limit (HTTP 413) verified.');

  console.log('\nAll mock HTTP pipeline tests passed successfully!');
  // Exit to close lingering listeners
  process.exit(0);
}

runMockTests().catch((err) => {
  console.error('Mock test failed:', err);
  process.exit(1);
});
