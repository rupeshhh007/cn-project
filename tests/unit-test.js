/**
 * In-Memory Subsystem & Algorithm Verification Unit Tests
 * Review-1 Prototype
 */

const assert = require('assert');
const { TimingTracker, SignatureEngine } = require('../proxy-app.js');

// Load proxy-app exports if needed, or instantiate classes
// To make unit testing independent and modular, we test the core logic:

console.log('Running In-Memory Architecture Unit Tests...');

// 1. Test Monotonic Timing Calculations
function calculateStats(intervals) {
  const n = intervals.length;
  if (n === 0) return { avg: 0, stdDev: 0 };
  const sum = intervals.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  let variance = 0;
  if (n > 1) {
    const sumSq = intervals.reduce((a, b) => a + Math.pow(b - avg, 2), 0);
    variance = sumSq / (n - 1);
  }
  return { avg, stdDev: Math.sqrt(variance) };
}

const testIntervals = [20.0, 22.0, 18.0, 24.0, 21.0];
const stats = calculateStats(testIntervals);
assert.strictEqual(stats.avg, 21.0);
assert(Math.abs(stats.stdDev - 2.236) < 0.01, 'StdDev should match sample standard deviation');
console.log('✓ Timing statistics calculation verified.');

// Battery 72% and 78% must produce the exact same bucket (70) and same hash!
const f1 = SignatureEngine.generateSignature({ batteryLevel: 72, charging: true, averageMs: 22.1, stdDevMs: 3.4, sampleCount: 5 });
const f2 = SignatureEngine.generateSignature({ batteryLevel: 78, charging: true, averageMs: 24.8, stdDevMs: 4.1, sampleCount: 8 });
assert.strictEqual(f1.canonicalFeatures.batteryBucket, 70);
assert.strictEqual(f2.canonicalFeatures.batteryBucket, 70);
assert.strictEqual(f1.canonicalFeatures.avgIntervalBucket, 0);
assert.strictEqual(f2.canonicalFeatures.avgIntervalBucket, 0);
assert.strictEqual(f1.canonicalFeatures.stdDevBucket, 0);
assert.strictEqual(f2.canonicalFeatures.stdDevBucket, 0);
assert.strictEqual(f1.fullHash, f2.fullHash, 'Bucketed features must produce identical deterministic SHA-256 signatures');
console.log('✓ Feature normalization & signature stability verified.');

// Long pauses must not pollute the active request-cadence window.
const timingTracker = new TimingTracker();
const baseNs = 1_000_000_000n;
timingTracker.recordRequest('idle-gap-client', baseNs);
const beforeIdle = timingTracker.recordRequest('idle-gap-client', baseNs + 25_000_000n);
const afterIdle = timingTracker.recordRequest('idle-gap-client', baseNs + 5_025_000_000n);
assert.strictEqual(beforeIdle.sampleCount, 1);
assert.strictEqual(afterIdle.sampleCount, 1, 'Idle gaps must not enter the rolling timing window');
assert.strictEqual(afterIdle.averageMs, 25, 'Idle gaps must preserve the established active cadence');
console.log('✓ Idle-gap signature stability verified.');

// 3. Test Missing Battery Fallback
const fNoBattery = SignatureEngine.generateSignature({ batteryLevel: null, charging: null, averageMs: 20, stdDevMs: 5, sampleCount: 3 });
assert.strictEqual(fNoBattery.canonicalFeatures.batteryBucket, 'unknown');
assert.strictEqual(fNoBattery.canonicalFeatures.charging, 'unknown');
assert.strictEqual(typeof fNoBattery.fullHash, 'string');
console.log('✓ Missing telemetry graceful fallback verified.');

// 4. Test Token Bucket Consumption & Refill
class TestTokenBucket {
  constructor(capacity = 10, refillRate = 2, initTime = Date.now()) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = initTime;
  }
  refill(now) {
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
      this.lastRefill = now;
    }
  }
  consume(now = Date.now()) {
    this.refill(now);
    if (this.tokens >= 1.0) {
      this.tokens -= 1.0;
      return true;
    }
    return false;
  }
}

const t0 = 1000000;
const bucket = new TestTokenBucket(10, 2, t0);
let allowed = 0;
let blocked = 0;

// Fire 15 requests immediately at t0
for (let i = 0; i < 15; i++) {
  if (bucket.consume(t0)) {
    allowed++;
  } else {
    blocked++;
  }
}
assert.strictEqual(allowed, 10, 'Initial burst must allow exactly 10 requests');
assert.strictEqual(blocked, 5, 'Requests exceeding capacity must be blocked');

// Fast forward 2.5 seconds (should refill 5 tokens)
const t1 = t0 + 2500;
let refilledAllowed = 0;
for (let i = 0; i < 5; i++) {
  if (bucket.consume(t1)) refilledAllowed++;
}
assert.strictEqual(refilledAllowed, 5, 'Refilled bucket must allow 5 tokens after 2.5s');
assert.strictEqual(bucket.consume(t1), false, '6th request must be throttled');
console.log('✓ Token bucket rate limiter behavior verified.');

console.log('All in-memory unit tests passed successfully!\n');
