import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, MODULES, DEFAULT_MODULES, HIDDEN_MODULES } from "@bitget-ai/bitget-agent-sdk";

const CRED_KEYS = [
  "BITGET_API_KEY",
  "BITGET_SECRET_KEY",
  "BITGET_PASSPHRASE",
  "BITGET_API_BASE_URL",
  "BITGET_TIMEOUT_MS",
];

describe("loadConfig", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of CRED_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of CRED_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to the core modules and no auth", () => {
    const config = loadConfig();
    expect(config.modules).toEqual(DEFAULT_MODULES);
    expect(config.hasAuth).toBe(false);
    expect(config.baseUrl).toBe("https://api.bitget.com");
  });

  it("modules=all means all to-C modules — the hidden to-B modules are excluded", () => {
    const config = loadConfig({ modules: "all" });
    const expected = MODULES.filter((m) => !HIDDEN_MODULES.includes(m));
    expect(config.modules).toEqual(expected);
    for (const hidden of HIDDEN_MODULES) {
      expect(config.modules).not.toContain(hidden);
    }
  });

  it("reveals a hidden to-B module only when it is named explicitly", () => {
    expect(loadConfig({ modules: "broker" }).modules).toEqual(["broker"]);
    // mixed with to-C modules: only the named hidden module is added
    expect(loadConfig({ modules: "account,instloan" }).modules).toEqual([
      "account",
      "instloan",
    ]);
  });

  it("rejects unknown modules", () => {
    expect(() => loadConfig({ modules: "spot" })).toThrow(/Unknown module/);
  });

  it("rejects partial credentials", () => {
    process.env.BITGET_API_KEY = "k";
    expect(() => loadConfig()).toThrow(/Partial API credentials/);
  });

  it("detects full credentials", () => {
    process.env.BITGET_API_KEY = "k";
    process.env.BITGET_SECRET_KEY = "s";
    process.env.BITGET_PASSPHRASE = "p";
    expect(loadConfig().hasAuth).toBe(true);
  });

  it("rejects readOnly + paperTrading together", () => {
    expect(() => loadConfig({ readOnly: true, paperTrading: true })).toThrow(
      /mutually exclusive/,
    );
  });
});
