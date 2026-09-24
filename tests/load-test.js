/**
 * Load Test & Cross-Layer Signature Mitigation Verification Script
 * Review-1 Prototype Test Suite
 *
 * Demonstrates:
 * 1. Rapid request transmission triggering token bucket exhaustion (HTTP 429).
 * 2. Simulated IP rotation (via X-Demo-IP) demonstrating that IP hopping
 *    does NOT bypass the token bucket when the cross-layer signature remains identical.
 * 3. Dynamic token bucket refill verification.
 *
 * Zero external npm dependencies — built-in http only.
 * Usage: node tests/load-test.js
 */

const http = require('http');
const assert = require('assert');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || 'localhost';
const CLIENT_ID = 'load-test-agent';
const TOTAL_REQUESTS = 25;
const REFILL_WAIT_MS = 2500; // 2.5s wait = 5 tokens refilled at 2 tok/sec

function sendHttpRequest(options, bodyData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {
          json = { raw: data };
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', (err) => reject(err));

    if (bodyData) {
      req.write(JSON.stringify(bodyData));
    }
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('================================================================');
  console.log(' CROSS-LAYER GATEWAY PROXY: LOAD TEST & SIGNATURE VERIFICATION  ');
  console.log('================================================================');
  console.log(` Target Server : http://${HOST}:${PORT}`);
  console.log(` Client ID     : ${CLIENT_ID}`);
  console.log(` Simulated IPs : 10.0.0.1 to 10.0.0.${TOTAL_REQUESTS}`);
  console.log(' Note: X-Demo-IP header is used strictly for simulated IP rotation');
  console.log('       to prove mitigation is keyed to cross-layer signature, not IP.');
  console.log('================================================================\n');

  // Step 1: Ingest Initial Telemetry
  console.log('[Step 1] Ingesting client device telemetry (/api/telemetry)...');
  try {
    const telemRes = await sendHttpRequest({
      hostname: HOST,
      port: PORT,
      path: '/api/telemetry',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      clientId: CLIENT_ID,
      batteryLevel: 75,
      charging: true
    });

    if (telemRes.statusCode === 200) {
      console.log(` ✓ Telemetry established: Battery 75%, Charging: true\n`);
    } else {
      console.warn(` ⚠ Warning: Telemetry endpoint returned HTTP ${telemRes.statusCode}\n`);
    }
  } catch (err) {
    console.error(` ✖ Failed to connect to server: ${err.message}`);
    console.error(' Please verify the server is running with `node proxy-app.js` first.');
    process.exit(1);
  }

  // Step 2: Rapid Burst with Simulated IP Rotation
  console.log(`[Step 2] Sending rapid burst of ${TOTAL_REQUESTS} requests with rotating IPs...`);
  let allowedCount = 0;
  let blockedCount = 0;
  let firstSignature = null;
  const burstSignatures = new Set();

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    const simulatedIp = `10.0.0.${i}`;
    const postData = {
      clientId: CLIENT_ID,
      payload: `burst-packet-${i}`
    };

    const res = await sendHttpRequest({
      hostname: HOST,
      port: PORT,
      path: '/api/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-IP': simulatedIp
      }
    }, postData);

    const sig = res.body?.signature || 'unknown';
    if (!firstSignature && sig !== 'unknown') {
      firstSignature = sig;
    }
    if (sig !== 'unknown') {
      burstSignatures.add(sig);
    }

    const padI = String(i).padStart(2, ' ');
    const padIp = simulatedIp.padEnd(10, ' ');

    if (res.statusCode === 200 && res.body.allowed) {
      allowedCount++;
      const tok = res.body.remainingTokens !== undefined ? res.body.remainingTokens.toFixed(2) : 'N/A';
      console.log(` Request ${padI} (IP: ${padIp}) -> 200 ALLOW    [Tokens: ${tok} | Sig: ${sig}]`);
    } else if (res.statusCode === 429) {
      blockedCount++;
      console.log(` Request ${padI} (IP: ${padIp}) -> 429 THROTTLE [RATE_LIMIT_EXCEEDED | Sig: ${sig}]`);
    } else {
      console.log(` Request ${padI} (IP: ${padIp}) -> ${res.statusCode} UNEXPECTED`);
    }

    // Small delay (20ms) to simulate rapid script traffic
    await sleep(20);
  }

  console.log('\n----------------------------------------------------------------');
  console.log(` Burst Phase Summary:`);
  console.log(` Total Sent   : ${TOTAL_REQUESTS}`);
  console.log(` Allowed (200): ${allowedCount}`);
  console.log(` Blocked (429): ${blockedCount}`);
  console.log(` Signature    : ${firstSignature || 'N/A'} (Persistent across all 25 IPs)`);
  console.log('----------------------------------------------------------------');

  assert.strictEqual(burstSignatures.size, 1, 'Rapid burst must retain one stable signature across rotated IPs');
  assert(blockedCount > 0, 'Rapid burst must exhaust the token bucket and return HTTP 429');
  assert.strictEqual(allowedCount + blockedCount, TOTAL_REQUESTS, 'Every burst request must receive a rate-limit decision');
  console.log(` ✓ SUCCESS: Stable signature exhausted one shared token bucket (${blockedCount} throttled)`);
  console.log('   despite 25 distinct IP addresses being used!\n');

  // Step 3: Verify Token Refill Dynamics
  console.log(`[Step 3] Waiting ${REFILL_WAIT_MS / 1000}s for token bucket refill (rate = 2 tokens/s)...`);
  await sleep(REFILL_WAIT_MS);

  console.log(`Sending 3 follow-up requests to verify token recovery...`);
  const recoverySignatures = new Set();
  let recoveryAllowed = 0;
  for (let k = 1; k <= 3; k++) {
    const simulatedIp = `10.0.0.${TOTAL_REQUESTS + k}`;
    const res = await sendHttpRequest({
      hostname: HOST,
      port: PORT,
      path: '/api/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Demo-IP': simulatedIp
      }
    }, {
      clientId: CLIENT_ID,
      payload: `recovery-packet-${k}`
    });

    const sig = res.body?.signature || 'unknown';
    if (sig !== 'unknown') recoverySignatures.add(sig);
    if (res.statusCode === 200 && res.body.allowed) recoveryAllowed++;
    const tok = res.body?.remainingTokens !== undefined ? res.body.remainingTokens.toFixed(2) : 'N/A';
    const statusStr = res.statusCode === 200 ? '200 ALLOW' : `${res.statusCode} THROTTLE`;
    console.log(` Follow-up ${k} (IP: ${simulatedIp.padEnd(10, ' ')}) -> ${statusStr} [Tokens: ${tok} | Sig: ${sig}]`);
    await sleep(50);
  }
  assert.deepStrictEqual([...recoverySignatures], [firstSignature], 'Signature must remain stable after an idle refill period');
  assert.strictEqual(recoveryAllowed, 3, 'Refilled bucket must allow all three recovery requests');

  // Step 4: Verify Stats Endpoint
  console.log('\n[Step 4] Querying /api/stats endpoint...');
  const statsRes = await sendHttpRequest({
    hostname: HOST,
    port: PORT,
    path: '/api/stats',
    method: 'GET'
  });

  if (statsRes.statusCode === 200) {
    console.log(' ✓ Gateway Stats Retrieved:');
    console.log(`   Total Requests Processed : ${statsRes.body.totalRequests}`);
    console.log(`   Global Allowed           : ${statsRes.body.allowedRequests}`);
    console.log(`   Global Blocked           : ${statsRes.body.blockedRequests}`);
    console.log(`   Active Signatures        : ${statsRes.body.activeSignatures}`);
  }

  console.log('\n================================================================');
  console.log(' LOAD TEST COMPLETED SUCCESSFULLY');
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
