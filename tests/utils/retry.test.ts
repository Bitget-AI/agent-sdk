import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY,
  MAX_RETRY_AFTER_MS,
  computeBackoffMs,
  isIdempotentRequest,
  isRetryableStatus,
  parseRetryAfter,
} from "@bitget-ai/bitget-agent-sdk";
import type { RetryConfig } from "@bitget-ai/bitget-agent-sdk";

describe("retry policy helpers", () => {
  describe("isIdempotentRequest", () => {
    it("treats every GET as idempotent (case-insensitive)", () => {
      expect(isIdempotentRequest("GET")).toBe(true);
      expect(isIdempotentRequest("get")).toBe(true);
    });

    it("treats a POST as idempotent only with a non-empty top-level clientOid", () => {
      expect(isIdempotentRequest("POST", { clientOid: "abc" })).toBe(true);
      expect(isIdempotentRequest("POST", { symbol: "BTCUSDT" })).toBe(false);
      expect(isIdempotentRequest("POST", { clientOid: "" })).toBe(false);
      expect(isIdempotentRequest("POST", undefined)).toBe(false);
    });

    it("treats batch (array) bodies as non-idempotent even if elements carry clientOid", () => {
      expect(isIdempotentRequest("POST", [{ clientOid: "a" }, { clientOid: "b" }])).toBe(false);
    });

    it("never retries other verbs", () => {
      expect(isIdempotentRequest("DELETE")).toBe(false);
      expect(isIdempotentRequest("PUT", { clientOid: "x" })).toBe(false);
    });
  });

  describe("isRetryableStatus", () => {
    it("matches 429 + 5xx and rejects 2xx/4xx", () => {
      for (const s of [429, 500, 502, 503, 504]) {
        expect(isRetryableStatus(s, DEFAULT_RETRY)).toBe(true);
      }
      for (const s of [200, 201, 400, 401, 404]) {
        expect(isRetryableStatus(s, DEFAULT_RETRY)).toBe(false);
      }
    });
  });

  describe("parseRetryAfter", () => {
    it("returns undefined for absent/garbage headers", () => {
      expect(parseRetryAfter(null)).toBeUndefined();
      expect(parseRetryAfter("not-a-date")).toBeUndefined();
    });

    it("parses delta-seconds to ms", () => {
      expect(parseRetryAfter("0")).toBe(0);
      expect(parseRetryAfter("1")).toBe(1000);
      expect(parseRetryAfter("5")).toBe(5000);
    });

    it("clamps an absurd delta to MAX_RETRY_AFTER_MS", () => {
      expect(parseRetryAfter("100000")).toBe(MAX_RETRY_AFTER_MS);
    });

    it("parses an HTTP-date relative to now", () => {
      const now = Date.UTC(2026, 0, 1, 0, 0, 0);
      const future = new Date(now + 2000).toUTCString();
      const ms = parseRetryAfter(future, now);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(2000);
      // a past date floors at 0
      expect(parseRetryAfter(new Date(now - 5000).toUTCString(), now)).toBe(0);
    });
  });

  describe("computeBackoffMs", () => {
    it("returns 0 when baseDelayMs is 0", () => {
      const cfg: RetryConfig = { ...DEFAULT_RETRY, baseDelayMs: 0, maxDelayMs: 0 };
      expect(computeBackoffMs(1, cfg)).toBe(0);
      expect(computeBackoffMs(4, cfg)).toBe(0);
    });

    it("grows exponentially within [capped, capped*1.25] and honors maxDelayMs", () => {
      const cfg: RetryConfig = {
        ...DEFAULT_RETRY,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      };
      const a1 = computeBackoffMs(1, cfg);
      expect(a1).toBeGreaterThanOrEqual(100);
      expect(a1).toBeLessThanOrEqual(125);

      const a2 = computeBackoffMs(2, cfg);
      expect(a2).toBeGreaterThanOrEqual(200);
      expect(a2).toBeLessThanOrEqual(250);

      // attempt 5 → 100*16 = 1600, capped at 1000
      const a5 = computeBackoffMs(5, cfg);
      expect(a5).toBeGreaterThanOrEqual(1000);
      expect(a5).toBeLessThanOrEqual(1250);
    });
  });
});
