import { describe, expect, it } from "vitest";
import {
  decodeError,
  classifyError,
  ERROR_CATALOG,
  BitgetApiError,
  NetworkError,
  ValidationError,
  toToolErrorPayload,
} from "@bitget-ai/bitget-agent-sdk";

describe("semantic error catalog", () => {
  it("decodes confirmed Bitget codes across every actionable category", () => {
    // one representative per category + retryable signal
    expect(decodeError("40001")).toMatchObject({ category: "auth", retryable: false });
    expect(decodeError("40017")?.category).toBe("auth"); // signature-param, kept aligned with client
    expect(decodeError("40034")).toMatchObject({ category: "param", retryable: false });
    expect(decodeError("25236")?.category).toBe("param"); // incorrect open type (hit live in E2E)
    expect(decodeError("25202")).toMatchObject({ category: "balance", retryable: false });
    expect(decodeError("25008")).toMatchObject({ category: "risk", retryable: false });
    expect(decodeError("25245")?.category).toBe("config"); // not unified (UTA) mode
    // HTTP transport status arrives as a stringified code → must classify, not fall through
    expect(decodeError("429")).toMatchObject({ category: "rate", retryable: true });
    expect(decodeError("503")).toMatchObject({ category: "network", retryable: true });
    expect(decodeError("25004")).toMatchObject({ category: "rate", retryable: true });
    // Unknown / invented codes must NOT decode.
    expect(decodeError("99999")).toBeUndefined();
    expect(decodeError(undefined)).toBeUndefined();
  });

  it("every catalog entry is well-formed (no invented/blank decodes)", () => {
    const VALID_CATEGORIES = new Set([
      "auth", "param", "balance", "risk", "rate", "region", "network", "config", "unknown",
    ]);
    const keys = Object.keys(ERROR_CATALOG);
    expect(keys.length).toBeGreaterThanOrEqual(30); // curated high-confidence subset
    for (const [code, decode] of Object.entries(ERROR_CATALOG)) {
      expect(/^\d+$/.test(code), `code ${code} is numeric`).toBe(true);
      expect(VALID_CATEGORIES.has(decode.category), `${code} category`).toBe(true);
      expect(decode.meaning.length, `${code} meaning`).toBeGreaterThan(0);
      expect(decode.suggestion.length, `${code} suggestion`).toBeGreaterThan(0);
      expect(typeof decode.retryable, `${code} retryable`).toBe("boolean");
      // only rate/network recoveries are ever retryable
      if (decode.retryable) {
        expect(["rate", "network"], `${code} retryable→category`).toContain(decode.category);
      }
    }
  });

  it("classify prefers a code decode, then falls back to the error type", () => {
    expect(classifyError("BitgetApiError", "40034")).toEqual({
      category: "param",
      retryable: false,
    });
    // regression: HTTP 429 arrives as BitgetApiError{code:"429"}; it must classify
    // as rate/retryable, not fall through to the BitgetApiError→unknown default.
    expect(classifyError("BitgetApiError", "429")).toEqual({
      category: "rate",
      retryable: true,
    });
    expect(classifyError("NetworkError")).toEqual({
      category: "network",
      retryable: true,
    });
    expect(classifyError("RateLimitError")).toEqual({
      category: "rate",
      retryable: true,
    });
    expect(classifyError("ValidationError")).toEqual({
      category: "param",
      retryable: false,
    });
    expect(classifyError("BitgetApiError", "code-not-in-table")).toEqual({
      category: "unknown",
      retryable: false,
    });
  });

  it("toToolErrorPayload enriches with category, retryable, and a decoded suggestion", () => {
    const apiErr = toToolErrorPayload(
      new BitgetApiError("param error", { code: "40034" }),
    );
    expect(apiErr.error.category).toBe("param");
    expect(apiErr.error.retryable).toBe(false);
    expect(apiErr.error.suggestion).toMatch(/Re-check parameter/);

    const netErr = toToolErrorPayload(new NetworkError("boom", "GET /x"));
    expect(netErr.error.category).toBe("network");
    expect(netErr.error.retryable).toBe(true);

    const valErr = toToolErrorPayload(new ValidationError("bad input"));
    expect(valErr.error.category).toBe("param");
    expect(valErr.error.retryable).toBe(false);

    const internal = toToolErrorPayload(new Error("totally unexpected"));
    expect(internal.error.type).toBe("InternalError");
    expect(internal.error.category).toBe("unknown");
    expect(internal.error.retryable).toBe(false);
  });
});
