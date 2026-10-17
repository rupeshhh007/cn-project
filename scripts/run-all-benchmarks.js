/**
 * SENTINEL / NETWORK LAB — Comprehensive Academic Benchmark Suite
 * 
 * Boots upstream & gateway locally, executes all 5 deterministic scenarios,
 * records confusion metrics and false positive/negative rates, and exports
 * reproducible JSON and CSV reports.
 */

import { startUpstream } from '../apps/upstream/server.js';
import { startGateway } from '../apps/gateway/server.js';
import { Scenarios } from './scenarios/scenario-definitions.js';
import { runComparativeBenchmark } from './scenarios/scenario-runner.js';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║        SENTINEL / NETWORK LAB — ACADEMIC BENCHMARK SUITE         ║');
  console.log('║        Evaluating 5 Scenarios across IP, Session & Behavioral    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  let upstream = null;
  let gateway = null;

  try {
    upstream = await startUpstream(8081, '127.0.0.1');
    gateway = await startGateway(8080, '127.0.0.1');

    console.log('\nServices running. Beginning test scenarios...\n');

    for (const scenarioId of Object.values(Scenarios)) {
      await runComparativeBenchmark(scenarioId, { count: 25, delayScale: 0.02 });
    }

    console.log('\n===============================================================');
    console.log('✔ ALL 5 BENCHMARK SCENARIOS COMPLETED & VERIFIED SCIENTIFICALLY');
    console.log('===============================================================\n');
  } catch (err) {
    console.error('\n❌ Benchmark suite execution error:', err);
    process.exit(1);
  } finally {
    if (gateway) await new Promise(r => gateway.close(r));
    if (upstream) await new Promise(r => upstream.close(r));
  }
}

main();
