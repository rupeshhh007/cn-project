/**
 * SENTINEL / NETWORK LAB — Upstream Application Service
 * 
 * An independent backend HTTP service providing real application API endpoints,
 * simulating database queries, measurable processing latencies, and structured responses.
 * 
 * This service is NOT exposed directly to public clients; it sits behind the
 * Sentinel Edge Reverse Proxy.
 */

import http from 'http';

const PORT = parseInt(process.env.UPSTREAM_PORT, 10) || 8081;
const HOST = process.env.UPSTREAM_HOST || '127.0.0.1';
const START_TIME = Date.now();

let requestCounter = 0;

function sendJson(res, statusCode, data, headers = {}) {
  const payload = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'X-Powered-By': 'Sentinel-Upstream/1.0',
    ...headers
  });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) {
        req.destroy();
        reject(new Error('UPSTREAM_BODY_EXCEEDED'));
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

const server = http.createServer(async (req, res) => {
  requestCounter++;
  const arrivalTime = Date.now();
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
      service: 'sentinel-upstream',
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
      totalRequestsReceived: requestCounter
    });
  }

  // 2. Sample data query endpoint
  if (pathname === '/api/data' && method === 'GET') {
    return sendJson(res, 200, {
      status: 'success',
      data: [
        { id: 101, sensor: 'temperature', value: 24.5, unit: 'C' },
        { id: 102, sensor: 'pressure', value: 1013.25, unit: 'hPa' },
        { id: 103, sensor: 'humidity', value: 55.2, unit: '%' }
      ],
      timestamp: new Date().toISOString(),
      forwardedByGateway: req.headers['x-forwarded-for'] || req.socket.remoteAddress
    });
  }

  // 3. Sample data ingestion endpoint (POST)
  if (pathname === '/api/data' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      return sendJson(res, 201, {
        status: 'created',
        recordId: `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        echo: body,
        processedAt: new Date().toISOString()
      });
    } catch (err) {
      return sendJson(res, 400, { error: 'Invalid JSON body in upstream request' });
    }
  }

  // 4. Latency measurement endpoint (simulates variable backend compute time)
  if (pathname === '/api/compute' && method === 'GET') {
    const delayParam = parseInt(parsedUrl.searchParams.get('delayMs') || '15', 10);
    const delayMs = Math.max(1, Math.min(200, delayParam));

    await new Promise(r => setTimeout(r, delayMs));

    return sendJson(res, 200, {
      status: 'computed',
      simulatedDelayMs: delayMs,
      upstreamServiceDurationMs: Date.now() - arrivalTime,
      resultHash: `comp_${Date.now()}`
    });
  }

  // 5. Echo endpoint for path inspection
  if (pathname.startsWith('/api/echo')) {
    return sendJson(res, 200, {
      method,
      path: pathname,
      headersReceived: {
        'x-sentinel-request-id': req.headers['x-sentinel-request-id'] || null,
        'x-client-id': req.headers['x-client-id'] || null,
        'x-forwarded-for': req.headers['x-forwarded-for'] || null
      },
      upstreamTimestamp: new Date().toISOString()
    });
  }

  // 404 for unknown upstream routes
  sendJson(res, 404, {
    error: 'Upstream route not found',
    requestedPath: pathname
  });
});

export function startUpstream(port = PORT, host = HOST) {
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      console.log(`[Upstream] Independent Backend Service running on http://${host}:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

// Auto-run if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startUpstream().catch(err => {
    console.error('[Upstream] Startup error:', err);
    process.exit(1);
  });
}
