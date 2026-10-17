/**
 * SENTINEL / NETWORK LAB — Scenario Runner & Benchmark Suite
 * 
 * Replays deterministic scenario traces across all 3 policies (IP_BASELINE,
 * SESSION_BASELINE, HYBRID_BEHAVIORAL), measuring confusion matrices,
 * latency overhead, and rate-limiting efficacy.
 * 
 * Usage:
 *   node scripts/scenarios/scenario-runner.js [scenario-id] [--all]
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Scenarios, ScenarioMetadata, generateScenarioTrace } from './scenario-definitions.js';
import { PolicyModes, DecisionTypes } from '../../packages/contracts/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.resolve(__dirname, '../../reports');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
const parsedGateway = new URL(GATEWAY_URL);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sendGatewayRequest({ path, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: parsedGateway.hostname,
      port: parsedGateway.port || 80,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          parsed = raw;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed
        });
      });
    });

    req.on('error', reject);
    if (payload) {
      req.end(payload);
    } else {
      req.end();
    }
  });
}

async function setGatewayPolicy(policyMode) {
  const res = await sendGatewayRequest({
    path: '/api/policy',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { policyMode }
  });
  if (res.statusCode !== 200) {
    throw new Error(`Failed to set policy to ${policyMode}: ${JSON.stringify(res.body)}`);
  }
}

async function resetGatewayState() {
  const res = await sendGatewayRequest({
    path: '/api/reset',
    method: 'POST'
  });
  if (res.statusCode !== 200) {
    throw new Error(`Failed to reset gateway: ${JSON.stringify(res.body)}`);
  }
}

/**
 * Runs a single trace under a specific policy mode.
 */
export async function runTraceUnderPolicy(scenarioId, policyMode, trace, { delayScale = 0.05 } = {}) {
  await setGatewayPolicy(policyMode);
  await resetGatewayState();

  const results = [];
  let tp = 0; // Malicious throttled
  let fp = 0; // Legitimate throttled (collateral damage)
  let tn = 0; // Legitimate allowed
  let fn = 0; // Malicious allowed (evasion)

  let totalLatency = 0;
  let allowedCount = 0;
  let throttledCount = 0;

  for (const item of trace) {
    // Inter-request pacing (scaled for fast test execution)
    const waitTime = Math.max(1, Math.round(item.delayMs * delayScale));
    await sleep(waitTime);

    const headers = {
      'X-Demo-IP': item.simulatedIp,
      'X-Client-ID': item.clientId
    };
    if (item.batteryLevel !== null) {
      headers['X-Telemetry-Battery'] = String(item.batteryLevel);
    }
    if (item.charging !== null) {
      headers['X-Telemetry-Charging'] = String(item.charging);
    }

    const tStart = process.hrtime.bigint();
    const res = await sendGatewayRequest({
      path: '/protected/api/data',
      headers
    });
    const tEnd = process.hrtime.bigint();
    const latencyMs = Number(tEnd - tStart) / 1_000_000.0;
    totalLatency += latencyMs;

    const decision = res.headers['x-sentinel-decision'] || (res.statusCode === 200 ? 'ALLOW' : 'THROTTLE');
    const isThrottled = decision === 'THROTTLE' || res.statusCode === 429;

    if (item.isMalicious) {
      if (isThrottled) tp++;
      else fn++;
    } else {
      if (isThrottled) fp++;
      else tn++;
    }

    if (isThrottled) throttledCount++;
    else allowedCount++;

    results.push({
      index: item.index,
      simulatedIp: item.simulatedIp,
      clientId: item.clientId,
      isMalicious: item.isMalicious,
      intendedDecision: item.intendedDecision,
      actualDecision: decision,
      httpStatus: res.statusCode,
      tokensRemaining: res.headers['x-sentinel-tokens'] || null,
      clusterId: res.headers['x-sentinel-cluster'] || null,
      latencyMs: Math.round(latencyMs * 100) / 100
    });
  }

  const total = trace.length;
  const accuracy = Math.round(((tp + tn) / total) * 1000) / 10;
  const fpr = (fp + tn) > 0 ? Math.round((fp / (fp + tn)) * 1000) / 10 : 0;
  const fnr = (tp + fn) > 0 ? Math.round((fn / (tp + fn)) * 1000) / 10 : 0;
  const precision = (tp + fp) > 0 ? Math.round((tp / (tp + fp)) * 1000) / 10 : 0;
  const recall = (tp + fn) > 0 ? Math.round((tp / (tp + fn)) * 1000) / 10 : 0;
  const avgLatencyMs = Math.round((totalLatency / total) * 100) / 100;

  return {
    scenarioId,
    policyMode,
    totalRequests: total,
    allowedCount,
    throttledCount,
    tp,
    fp,
    tn,
    fn,
    accuracyPercent: accuracy,
    falsePositiveRatePercent: fpr,
    falseNegativeRatePercent: fnr,
    precisionPercent: precision,
    recallPercent: recall,
    avgLatencyMs,
    results
  };
}

/**
 * Runs a comparative benchmark across all 3 policies for a given scenario.
 */
export async function runComparativeBenchmark(scenarioId, { count = 25, seed = 1337, delayScale = 0.05 } = {}) {
  const meta = ScenarioMetadata[scenarioId];
  console.log(`\n===============================================================`);
  console.log(`🔬 BENCHMARK SCENARIO: ${meta.name.toUpperCase()}`);
  console.log(`Category: ${meta.category}`);
  console.log(`Description: ${meta.description}`);
  console.log(`===============================================================`);

  const trace = generateScenarioTrace(scenarioId, { count, seed });

  const policies = [
    PolicyModes.IP_BASELINE,
    PolicyModes.SESSION_BASELINE,
    PolicyModes.HYBRID_BEHAVIORAL
  ];

  const policySummaries = [];

  for (const policy of policies) {
    process.stdout.write(`  Evaluating ${policy.padEnd(20)}... `);
    const summary = await runTraceUnderPolicy(scenarioId, policy, trace, { delayScale });
    policySummaries.push(summary);
    console.log(`Allowed: ${String(summary.allowedCount).padStart(2)}, Throttled: ${String(summary.throttledCount).padStart(2)}, FPR: ${summary.falsePositiveRatePercent}%, FNR: ${summary.falseNegativeRatePercent}%, Latency: ${summary.avgLatencyMs}ms`);
  }

  // Display comparison table
  console.log('\n--- Policy Comparison Summary ---');
  console.table(policySummaries.map(s => ({
    Policy: s.policyMode,
    Allowed: s.allowedCount,
    Throttled: s.throttledCount,
    'TP (Bot Throttled)': s.tp,
    'FP (Human Throttled)': s.fp,
    'FPR %': `${s.falsePositiveRatePercent}%`,
    'FNR %': `${s.falseNegativeRatePercent}%`,
    'Accuracy %': `${s.accuracyPercent}%`,
    'Avg Latency': `${s.avgLatencyMs}ms`
  })));

  // Ensure reports dir exists
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // Export JSON Report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORTS_DIR, `benchmark-${scenarioId}-${timestamp}.json`);
  const reportData = {
    scenarioId,
    scenarioMetadata: meta,
    timestamp: new Date().toISOString(),
    comparisons: policySummaries.map(s => ({
      policyMode: s.policyMode,
      totalRequests: s.totalRequests,
      allowedCount: s.allowedCount,
      throttledCount: s.throttledCount,
      tp: s.tp,
      fp: s.fp,
      tn: s.tn,
      fn: s.fn,
      accuracyPercent: s.accuracyPercent,
      falsePositiveRatePercent: s.falsePositiveRatePercent,
      falseNegativeRatePercent: s.falseNegativeRatePercent,
      avgLatencyMs: s.avgLatencyMs
    }))
  };

  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf8');
  console.log(`\n📄 Benchmark report exported to: ${reportPath}`);

  // Export CSV Report
  const csvPath = path.join(REPORTS_DIR, `benchmark-${scenarioId}-${timestamp}.csv`);
  const csvRows = [
    ['Policy', 'TotalRequests', 'Allowed', 'Throttled', 'TP', 'FP', 'TN', 'FN', 'AccuracyPercent', 'FPRPercent', 'FNRPercent', 'AvgLatencyMs'].join(',')
  ];
  for (const s of policySummaries) {
    csvRows.push([
      s.policyMode,
      s.totalRequests,
      s.allowedCount,
      s.throttledCount,
      s.tp,
      s.fp,
      s.tn,
      s.fn,
      s.accuracyPercent,
      s.falsePositiveRatePercent,
      s.falseNegativeRatePercent,
      s.avgLatencyMs
    ].join(','));
  }
  fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
  console.log(`📄 CSV exported to: ${csvPath}`);

  return reportData;
}

// CLI Execution
if (process.argv[1] && process.argv[1].endsWith('scenario-runner.js')) {
  const targetScenario = process.argv[2] || Scenarios.SCENARIO_2_IP_ROTATION;
  const runAll = process.argv.includes('--all');

  (async () => {
    try {
      if (runAll) {
        console.log('Running all 5 benchmark scenarios...');
        for (const scId of Object.values(Scenarios)) {
          await runComparativeBenchmark(scId);
        }
      } else {
        await runComparativeBenchmark(targetScenario);
      }
      process.exit(0);
    } catch (err) {
      console.error('\n❌ Scenario runner failed:', err);
      process.exit(1);
    }
  })();
}
