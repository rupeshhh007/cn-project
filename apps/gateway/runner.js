/**
 * SENTINEL / NETWORK LAB — Dual Service Runner
 * 
 * Boots both the independent upstream application service (port 8081)
 * and the Sentinel Edge Reverse Proxy (port 8080) concurrently in a single process.
 */

import { startUpstream } from '../upstream/server.js';
import { startGateway } from './server.js';

const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || process.env.PORT, 10) || 8080;
const UPSTREAM_PORT = parseInt(process.env.UPSTREAM_PORT, 10) || 8081;
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║               SENTINEL / NETWORK LAB — BACKEND                   ║');
  console.log('║       Explainable Traffic Defense Workbench & Reverse Proxy      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  try {
    const upstream = await startUpstream(UPSTREAM_PORT, '127.0.0.1');
    const gateway = await startGateway(GATEWAY_PORT, HOST);

    console.log('\n[Ready] Sentinel system running:');
    console.log(`  ▸ Edge Reverse Proxy : http://localhost:${GATEWAY_PORT}`);
    console.log(`  ▸ Upstream Backend   : http://localhost:${UPSTREAM_PORT}`);
    console.log(`  ▸ Protected Forward  : http://localhost:${GATEWAY_PORT}/protected/api/data`);
    console.log(`  ▸ System Overview    : http://localhost:${GATEWAY_PORT}/api/overview`);
    console.log(`  ▸ Live SSE Stream    : http://localhost:${GATEWAY_PORT}/api/events\n`);

    const shutdown = () => {
      console.log('\n[Shutdown] Terminating Sentinel services...');
      gateway.close(() => {
        upstream.close(() => {
          console.log('[Shutdown] All services cleanly stopped.');
          process.exit(0);
        });
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  }
}

main();
