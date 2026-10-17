import crypto from 'crypto';
import { PolicyModes, DecisionTypes, DecisionReasons } from '../contracts/index.js';
import { TokenBucket } from './token-bucket.js';
import { SignalExtractor } from './signal-extractor.js';

export class PolicyEngine {
  constructor({
    defaultPolicy = PolicyModes.HYBRID_BEHAVIORAL,
    capacity = 10.0,
    refillRate = 2.0,
    minSamplesForBehavioral = 4
  } = {}) {
    this.activePolicy = defaultPolicy;
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.minSamples = minSamplesForBehavioral;

    // Token buckets partitioned by policy scope
    // Map<ip, TokenBucket>
    this.ipBuckets = new Map();
    // Map<sessionId, TokenBucket>
    this.sessionBuckets = new Map();
    // Map<clusterId, TokenBucket>
    this.clusterBuckets = new Map();

    // Signal extraction subsystem
    this.signalExtractor = new SignalExtractor();
  }

  setPolicy(policyMode) {
    if (!Object.values(PolicyModes).includes(policyMode)) {
      throw new Error(`Invalid PolicyMode: ${policyMode}`);
    }
    this.activePolicy = policyMode;
  }

  getPolicy() {
    return this.activePolicy;
  }

  resetState() {
    this.ipBuckets.clear();
    this.sessionBuckets.clear();
    this.clusterBuckets.clear();
    this.signalExtractor.clear();
  }

  _getOrCreateBucket(map, key) {
    let b = map.get(key);
    if (!b) {
      b = new TokenBucket({ capacity: this.capacity, refillRate: this.refillRate });
      map.set(key, b);
    }
    return b;
  }

  /**
   * Generates a deterministic behavioral cluster ID from statistical and telemetry features.
   */
  _computeClusterId({ averageMs, stdDevMs, batteryLevel = null, charging = null }) {
    // Quantize average interval to 50ms buckets
    const avgBucket = Math.floor(averageMs / 50) * 50;
    // Quantize std deviation to 50ms buckets
    const stdBucket = Math.floor(stdDevMs / 50) * 50;

    let batteryBucket = 'none';
    if (typeof batteryLevel === 'number' && !isNaN(batteryLevel)) {
      batteryBucket = String(Math.floor(Math.max(0, Math.min(100, batteryLevel)) / 10) * 10);
    }

    const chargingStr = typeof charging === 'boolean' ? (charging ? 'true' : 'false') : 'none';

    // Canonical JSON representation
    const canonical = JSON.stringify({
      a: avgBucket,
      b: batteryBucket,
      c: chargingStr,
      s: stdBucket
    });

    const hash = crypto.createHash('sha256').update(canonical).digest('hex');
    return hash.slice(0, 12);
  }

  /**
   * Evaluates an incoming request against the current active policy.
   * @param {Object} reqData
   * @returns {{ decision: string, reason: string, clusterId: string|null, signalConfidence: number, tokensRemaining: number, tokensCapacity: number, timing: Object }}
   */
  evaluateRequest(reqData) {
    const {
      socketRemoteIp,
      simulatedSourceIp = null,
      clientIdentifier = 'anonymous',
      batteryLevel = null,
      charging = null,
      arrivalNs = process.hrtime.bigint(),
      nowMs = Date.now()
    } = reqData;

    // Use simulated IP when in scenario testing mode; otherwise real socket IP
    const effectiveIp = simulatedSourceIp || socketRemoteIp;

    // Record timing signals for this entity
    const timingKey = `${effectiveIp}:${clientIdentifier}`;
    const timing = this.signalExtractor.recordArrival(timingKey, arrivalNs, nowMs);

    let decision = DecisionTypes.ALLOW;
    let reason = DecisionReasons.TOKEN_AVAILABLE;
    let clusterId = null;
    let confidence = 0.0;
    let bucketResult = null;

    switch (this.activePolicy) {
      case PolicyModes.IP_BASELINE: {
        const bucket = this._getOrCreateBucket(this.ipBuckets, effectiveIp);
        bucketResult = bucket.consume(1.0, nowMs);
        confidence = 1.0;
        if (!bucketResult.allowed) {
          decision = DecisionTypes.THROTTLE;
          reason = DecisionReasons.RATE_LIMIT_EXCEEDED;
        }
        break;
      }

      case PolicyModes.SESSION_BASELINE: {
        const bucket = this._getOrCreateBucket(this.sessionBuckets, clientIdentifier);
        bucketResult = bucket.consume(1.0, nowMs);
        confidence = 0.4; // Explicitly lower confidence due to spoofability
        if (!bucketResult.allowed) {
          decision = DecisionTypes.THROTTLE;
          reason = DecisionReasons.RATE_LIMIT_EXCEEDED;
        }
        break;
      }

      case PolicyModes.HYBRID_BEHAVIORAL:
      default: {
        // Cold start check: fall back to IP baseline until sufficient timing samples exist
        if (timing.sampleCount < this.minSamples) {
          const ipBucket = this._getOrCreateBucket(this.ipBuckets, effectiveIp);
          bucketResult = ipBucket.consume(1.0, nowMs);
          confidence = 0.3; // Warm-up state
          reason = bucketResult.allowed
            ? DecisionReasons.COLD_START_IP_FALLBACK
            : DecisionReasons.RATE_LIMIT_EXCEEDED;
          if (!bucketResult.allowed) {
            decision = DecisionTypes.THROTTLE;
          }
        } else {
          // Establish behavioral cluster
          clusterId = this._computeClusterId({
            averageMs: timing.averageMs,
            stdDevMs: timing.stdDevMs,
            batteryLevel,
            charging
          });

          // Confidence increases with sample count and cadence stability
          const sampleFactor = Math.min(1.0, timing.sampleCount / 10.0);
          confidence = Math.round((0.5 + 0.5 * sampleFactor) * 100) / 100;

          let clusterBucket = this.clusterBuckets.get(clusterId);
          if (!clusterBucket) {
            // Carry over remaining tokens from cold-start IP bucket to prevent quota reset exploit
            const ipBucket = this.ipBuckets.get(effectiveIp);
            const initialTokens = ipBucket ? Math.min(this.capacity, Math.max(0, ipBucket.tokens)) : this.capacity;
            clusterBucket = new TokenBucket({
              capacity: this.capacity,
              refillRate: this.refillRate,
              initialTokens
            });
            this.clusterBuckets.set(clusterId, clusterBucket);
          }
          bucketResult = clusterBucket.consume(1.0, nowMs);

          if (!bucketResult.allowed) {
            decision = DecisionTypes.THROTTLE;
            reason = DecisionReasons.RATE_LIMIT_EXCEEDED;
          }
        }
        break;
      }
    }

    return {
      policyMode: this.activePolicy,
      decision,
      reason,
      clusterId,
      signalConfidence: confidence,
      tokensRemaining: bucketResult.remainingTokens,
      tokensCapacity: this.capacity,
      timing
    };
  }
}
