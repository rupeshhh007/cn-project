import assert from 'assert';
import { TokenBucket } from '../token-bucket.js';
import { SignalExtractor } from '../signal-extractor.js';
import { PolicyEngine } from '../policy-engine.js';
import { PolicyModes, DecisionTypes, DecisionReasons } from '../../contracts/index.js';

console.log('--- Running @sentinel/core Unit Tests ---');

// 1. TokenBucket Tests
console.log('[Test Suite 1] TokenBucket State Machine');
{
  const tb = new TokenBucket({ capacity: 5.0, refillRate: 1.0, initialTokens: 5.0, now: 1000 });
  
  // Initial consumption
  const r1 = tb.consume(1.0, 1000);
  assert.strictEqual(r1.allowed, true);
  assert.strictEqual(r1.remainingTokens, 4.0);

  // Consume remainder
  tb.consume(4.0, 1000);
  const rEmpty = tb.consume(1.0, 1000);
  assert.strictEqual(rEmpty.allowed, false);
  assert.strictEqual(rEmpty.remainingTokens, 0.0);

  // Partial refill after 1.5 seconds (should have 1.5 tokens)
  const rRefill = tb.consume(1.0, 2500);
  assert.strictEqual(rRefill.allowed, true);
  assert.strictEqual(rRefill.remainingTokens, 0.5);

  // Capacity cap check after 100 seconds
  const rCap = tb.getSnapshot(100000);
  assert.strictEqual(rCap.tokens, 5.0);
  console.log('  ✔ TokenBucket consumption, refusal, and refill dynamics verified.');
}

// 2. SignalExtractor Tests
console.log('[Test Suite 2] SignalExtractor Rolling Statistics');
{
  const se = new SignalExtractor({ windowSize: 5, idleGapMs: 1000 });
  const key = 'test-client';

  // First arrival (baseline, 0 gap)
  const s0 = se.recordArrival(key, 0n, 0);
  assert.strictEqual(s0.sampleCount, 0);
  assert.strictEqual(s0.averageMs, 0);

  // Record 100ms gap (100_000_000 ns)
  const s1 = se.recordArrival(key, 100_000_000n, 100);
  assert.strictEqual(s1.sampleCount, 1);
  assert.strictEqual(s1.averageMs, 100);

  // Record another 100ms gap
  const s2 = se.recordArrival(key, 200_000_000n, 200);
  assert.strictEqual(s2.sampleCount, 2);
  assert.strictEqual(s2.averageMs, 100);
  assert.strictEqual(s2.stdDevMs, 0);
  assert.strictEqual(s2.cv, 0);

  // Record 200ms gap (100, 100, 200 -> avg 133.33)
  const s3 = se.recordArrival(key, 400_000_000n, 400);
  assert.strictEqual(s3.sampleCount, 3);
  assert.strictEqual(s3.averageMs, 133.33);

  // Record idle gap > 1000ms (should be filtered from intervals)
  const sIdle = se.recordArrival(key, 2_000_000_000n, 2000);
  assert.strictEqual(sIdle.sampleCount, 3, 'Idle gap must not distort cadence window');

  console.log('  ✔ SignalExtractor mean, std dev, CV, and idle-gap filtering verified.');
}

// 3. PolicyEngine Tests
console.log('[Test Suite 3] PolicyEngine Evaluation and Switching');
{
  const pe = new PolicyEngine({
    defaultPolicy: PolicyModes.IP_BASELINE,
    capacity: 3.0,
    refillRate: 1.0,
    minSamplesForBehavioral: 3
  });

  // IP_BASELINE Mode
  const ip1 = pe.evaluateRequest({ socketRemoteIp: '10.0.0.1', nowMs: 1000 });
  assert.strictEqual(ip1.decision, DecisionTypes.ALLOW);
  assert.strictEqual(ip1.tokensRemaining, 2.0);

  pe.evaluateRequest({ socketRemoteIp: '10.0.0.1', nowMs: 1000 });
  pe.evaluateRequest({ socketRemoteIp: '10.0.0.1', nowMs: 1000 });
  const ipThrottle = pe.evaluateRequest({ socketRemoteIp: '10.0.0.1', nowMs: 1000 });
  assert.strictEqual(ipThrottle.decision, DecisionTypes.THROTTLE);
  assert.strictEqual(ipThrottle.reason, DecisionReasons.RATE_LIMIT_EXCEEDED);

  // Distinct IP has separate bucket
  const ip2 = pe.evaluateRequest({ socketRemoteIp: '10.0.0.2', nowMs: 1000 });
  assert.strictEqual(ip2.decision, DecisionTypes.ALLOW);
  assert.strictEqual(ip2.tokensRemaining, 2.0);

  // Switch to HYBRID_BEHAVIORAL with cold start
  pe.resetState();
  pe.setPolicy(PolicyModes.HYBRID_BEHAVIORAL);
  
  // Cold start fallback
  const hb1 = pe.evaluateRequest({ socketRemoteIp: '10.0.0.1', clientIdentifier: 'dev', nowMs: 1000 });
  assert.strictEqual(hb1.decision, DecisionTypes.ALLOW);
  assert.strictEqual(hb1.reason, DecisionReasons.COLD_START_IP_FALLBACK);

  console.log('  ✔ PolicyEngine IP_BASELINE, HYBRID_BEHAVIORAL, and cold start fallback verified.');
}

console.log('\n✔ ALL @sentinel/core UNIT TESTS PASSED SUCCESSFULLY!');
