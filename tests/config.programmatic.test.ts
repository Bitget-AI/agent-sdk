import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, ConfigError, DEFAULT_RETRY } from "@bitget-ai/bitget-agent-sdk";

const ENV_KEYS = [
  "BITGET_API_KEY",
  "BITGET_SECRET_KEY",
  "BITGET_PASSPHRASE",
  "BITGET_API_BASE_URL",
  "BITGET_TIMEOUT_MS",
  "BITGET_MAX_RETRIES",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("programmatic credentials (P1-8)", () => {
  it("accepts credentials passed via options when no env is set", () => {
    const cfg = loadConfig({ apiKey: "k", secretKey: "s", passphrase: "p" });
    expect(cfg.hasAuth).toBe(true);
    expect(cfg.apiKey).toBe("k");
  });

  it("option credentials take precedence over env vars", () => {
    process.env.BITGET_API_KEY = "env-key";
    process.env.BITGET_SECRET_KEY = "env-secret";
    process.env.BITGET_PASSPHRASE = "env-pass";
    const cfg = loadConfig({ apiKey: "cli-key", secretKey: "cli-secret", passphrase: "cli-pass" });
    expect(cfg.apiKey).toBe("cli-key");
    expect(cfg.secretKey).toBe("cli-secret");
    expect(cfg.passphrase).toBe("cli-pass");
  });

  it("rejects partial programmatic credentials", () => {
    expect(() => loadConfig({ apiKey: "only-key" })).toThrow(ConfigError);
  });
});

describe("programmatic baseUrl / timeout / userAgent", () => {
  it("overrides baseUrl and strips trailing slashes", () => {
    expect(loadConfig({ baseUrl: "https://example.test/" }).baseUrl).toBe("https://example.test");
  });

  it("rejects an invalid baseUrl", () => {
    expect(() => loadConfig({ baseUrl: "ftp://nope" })).toThrow(ConfigError);
  });

  it("overrides timeoutMs and rejects non-positive values", () => {
    expect(loadConfig({ timeoutMs: 1234 }).timeoutMs).toBe(1234);
    expect(() => loadConfig({ timeoutMs: 0 })).toThrow(ConfigError);
  });

  it("defaults the User-Agent and honors an override", () => {
    expect(loadConfig().userAgent).toBe("bitget-agent-sdk/3.0.0 (node)");
    expect(loadConfig({ userAgent: "custom/1.0" }).userAgent).toBe("custom/1.0");
  });
});

describe("retry configuration (P0-2)", () => {
  it("defaults to DEFAULT_RETRY with a fresh status array", () => {
    const cfg = loadConfig();
    expect(cfg.retry.maxRetries).toBe(DEFAULT_RETRY.maxRetries);
    expect(cfg.retry.retryableStatuses).toEqual(DEFAULT_RETRY.retryableStatuses);
    expect(cfg.retry.retryableStatuses).not.toBe(DEFAULT_RETRY.retryableStatuses);
  });

  it("merges a partial retry override over defaults", () => {
    const cfg = loadConfig({ retry: { maxRetries: 5 } });
    expect(cfg.retry.maxRetries).toBe(5);
    expect(cfg.retry.baseDelayMs).toBe(DEFAULT_RETRY.baseDelayMs);
  });

  it("reads BITGET_MAX_RETRIES from env", () => {
    process.env.BITGET_MAX_RETRIES = "4";
    expect(loadConfig().retry.maxRetries).toBe(4);
  });

  it("rejects an invalid BITGET_MAX_RETRIES", () => {
    process.env.BITGET_MAX_RETRIES = "-1";
    expect(() => loadConfig()).toThrow(ConfigError);
  });

  it("option retry overrides the env value", () => {
    process.env.BITGET_MAX_RETRIES = "4";
    expect(loadConfig({ retry: { maxRetries: 1 } }).retry.maxRetries).toBe(1);
  });
});
