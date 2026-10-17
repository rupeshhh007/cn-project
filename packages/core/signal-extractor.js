/**
 * SignalExtractor
 * Extracts application-visible arrival timing statistics and behavioral metrics.
 */

export class SignalExtractor {
  constructor({ windowSize = 20, idleGapMs = 2000, ttlMs = 15 * 60 * 1000 } = {}) {
    this.windowSize = windowSize;
    this.idleGapMs = idleGapMs;
    this.ttlMs = ttlMs;
    // Map<key, { lastNs: bigint, intervalsMs: number[], lastActiveMs: number, count: number }>
    this.entities = new Map();
  }

  recordArrival(key, currentNs = process.hrtime.bigint(), nowMs = Date.now()) {
    let entry = this.entities.get(key);

    if (!entry) {
      entry = {
        lastNs: currentNs,
        intervalsMs: [],
        lastActiveMs: nowMs,
        count: 1
      };
      this.entities.set(key, entry);
      return {
        gapMs: 0,
        sampleCount: 0,
        averageMs: 0,
        varianceMs: 0,
        stdDevMs: 0,
        cv: 0,
        totalSeen: 1
      };
    }

    const gapNs = currentNs - entry.lastNs;
    const gapMs = Number(gapNs) / 1_000_000.0;
    entry.lastNs = currentNs;
    entry.lastActiveMs = nowMs;
    entry.count += 1;

    // Filter idle pauses between active bursts to preserve cadence integrity
    if (gapMs <= this.idleGapMs) {
      entry.intervalsMs.push(gapMs);
      if (entry.intervalsMs.length > this.windowSize) {
        entry.intervalsMs.shift();
      }
    }

    const n = entry.intervalsMs.length;
    if (n === 0) {
      return {
        gapMs: Math.round(gapMs * 100) / 100,
        sampleCount: 0,
        averageMs: 0,
        varianceMs: 0,
        stdDevMs: 0,
        cv: 0,
        totalSeen: entry.count
      };
    }

    const sum = entry.intervalsMs.reduce((a, b) => a + b, 0);
    const avg = sum / n;

    let variance = 0;
    if (n > 1) {
      const sumSq = entry.intervalsMs.reduce((a, b) => a + Math.pow(b - avg, 2), 0);
      variance = sumSq / (n - 1);
    }
    const stdDev = Math.sqrt(variance);
    const cv = avg > 0 ? stdDev / avg : 0;

    return {
      gapMs: Math.round(gapMs * 100) / 100,
      sampleCount: n,
      averageMs: Math.round(avg * 100) / 100,
      varianceMs: Math.round(variance * 100) / 100,
      stdDevMs: Math.round(stdDev * 100) / 100,
      cv: Math.round(cv * 1000) / 1000,
      totalSeen: entry.count
    };
  }

  cleanupStale(nowMs = Date.now()) {
    for (const [key, data] of this.entities.entries()) {
      if (nowMs - data.lastActiveMs > this.ttlMs) {
        this.entities.delete(key);
      }
    }
  }

  clear() {
    this.entities.clear();
  }
}
