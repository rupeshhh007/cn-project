/**
 * Leaky Token Bucket implementation.
 * Capacity C, refill rate r tokens/second.
 */

export class TokenBucket {
  constructor({ capacity = 10.0, refillRate = 2.0, initialTokens = null, now = Date.now() } = {}) {
    this.capacity = Number(capacity);
    this.refillRate = Number(refillRate);
    this.tokens = initialTokens !== null ? Number(initialTokens) : this.capacity;
    this.lastRefill = now;
  }

  refill(now = Date.now()) {
    const elapsedSec = (now - this.lastRefill) / 1000.0;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + (elapsedSec * this.refillRate));
      this.lastRefill = now;
    }
  }

  consume(cost = 1.0, now = Date.now()) {
    this.refill(now);
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return {
        allowed: true,
        remainingTokens: Math.round(this.tokens * 100) / 100
      };
    }
    return {
      allowed: false,
      remainingTokens: Math.round(this.tokens * 100) / 100
    };
  }

  getSnapshot(now = Date.now()) {
    this.refill(now);
    return {
      tokens: Math.round(this.tokens * 100) / 100,
      capacity: this.capacity,
      refillRate: this.refillRate
    };
  }
}
