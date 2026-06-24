import type { RateLimitConfig } from "../utils/rate-limiter.js";

/** Public market endpoints: generous client-side budget. */
export function publicRateLimit(key: string, rps = 20): RateLimitConfig {
  return { key: `public:${key}`, capacity: rps, refillPerSecond: rps };
}

/** Private (signed) endpoints: conservative client-side budget. */
export function privateRateLimit(key: string, rps = 10): RateLimitConfig {
  return { key: `private:${key}`, capacity: rps, refillPerSecond: rps };
}
