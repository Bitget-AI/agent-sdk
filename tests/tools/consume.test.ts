import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockServer } from "@bitget-ai/bitget-agent-sdk/testing";
import {
  BitgetRestClient,
  buildTools,
  loadConfig,
  safeInvoke,
  toMcpTool,
  MCP_TOOL_NAME_PATTERN,
  MODULES,
} from "@bitget-ai/bitget-agent-sdk";
import type { SafeResult, ToolContext, ToolSpec } from "@bitget-ai/bitget-agent-sdk";

// FULL spans the entire catalog — name every module explicitly since
// `modules: "all"` omits the hidden to-B modules. INTENT is the real default
// to-C intent surface (hidden to-B verbs absent).
const FULL = buildTools(loadConfig({ modules: MODULES.join(","), surface: "full" }));
const INTENT = buildTools(loadConfig({ modules: "all", surface: "intent" }));

function keys(schema: ToolSpec["inputSchema"]): string[] {
  return Object.keys(schema.properties);
}

describe("L3 contract: static tool shape (MCP-ready)", () => {
  it("every tool name matches the MCP tool-name rule", () => {
    const bad = [...FULL, ...INTENT]
      .map((t) => t.name)
      .filter((n) => !MCP_TOOL_NAME_PATTERN.test(n));
    expect(bad).toEqual([]);
  });

  it("every inputSchema is a valid object schema; required ⊆ properties (or additionalProperties)", () => {
    const bad: string[] = [];
    for (const t of FULL) {
      const s = t.inputSchema;
      if (s.type !== "object" || typeof s.properties !== "object" || s.properties === null) {
        bad.push(`${t.name}: not an object schema`);
        continue;
      }
      const props = new Set(keys(s));
      const required = s.required ?? [];
      const missing = required.filter((r) => !props.has(r));
      // A required key that is not a declared property is only acceptable when
      // the schema is open (additionalProperties:true) — otherwise it can never
      // be satisfied. Our schemas are open, but the contract is what we assert.
      if (missing.length > 0 && s.additionalProperties !== true) {
        bad.push(`${t.name}: required not in properties → ${missing.join(",")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("toMcpTool projects name/description/inputSchema and drops the handler", () => {
    const order = FULL.find((t) => t.name === "order")!;
    const mcp = toMcpTool(order);
    expect(mcp).toEqual({
      name: order.name,
      description: order.description,
      inputSchema: order.inputSchema,
    });
    expect("handler" in mcp).toBe(false);
    // the schema is shared by reference — projection, not a copy/transform
    expect(mcp.inputSchema).toBe(order.inputSchema);
  });
});

describe("L3 contract: safeInvoke runtime envelope", () => {
  let ctx: ToolContext;
  let server: MockServer;

  beforeAll(async () => {
    server = new MockServer();
    await server.start();
    process.env.BITGET_API_BASE_URL = server.baseUrl;
    process.env.BITGET_API_KEY = "key";
    process.env.BITGET_SECRET_KEY = "secret";
    process.env.BITGET_PASSPHRASE = "pass";
    const config = loadConfig({ modules: "all" });
    ctx = { config, client: new BitgetRestClient(config) };
  });

  afterAll(async () => {
    delete process.env.BITGET_API_BASE_URL;
    delete process.env.BITGET_API_KEY;
    delete process.env.BITGET_SECRET_KEY;
    delete process.env.BITGET_PASSPHRASE;
    await server.stop();
  });

  const verb = (name: string, config = ctx.config): ToolSpec => {
    const t = buildTools(config).find((x) => x.name === name);
    if (!t) throw new Error(`tool ${name} not found`);
    return t;
  };

  it("tags a successful read as { ok: true } with the ToolResult fields", async () => {
    server.setResponseOverride("getTickers", [{ symbol: "BTCUSDT", lastPr: "50000" }]);
    const res = await safeInvoke(verb("market"), { action: "tickers", category: "SPOT" }, ctx);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.endpoint).toContain("/api/v3/market/tickers");
      expect(typeof res.requestTime).toBe("string");
      expect(Array.isArray(res.data)).toBe(true);
    }
  });

  it("converts a thrown ValidationError into the { ok: false, error } envelope", async () => {
    const res = await safeInvoke(verb("order"), { action: "nope" }, ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.type).toBe("ValidationError");
      expect(typeof res.error.category).toBe("string");
      expect(res.error.retryable).toBe(false);
      expect(res.error.endpoint).toBe("(composite) order");
      expect(typeof res.timestamp).toBe("string");
    }
  });

  it("envelopes a readOnly self-guard rejection (write blocked) as ok:false", async () => {
    const ro = loadConfig({ modules: "all", readOnly: true });
    const roCtx: ToolContext = { config: ro, client: new BitgetRestClient(ro) };
    const res = await safeInvoke(
      verb("order", ro),
      { action: "place", symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "1", qty: "1" },
      roCtx,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/readOnly/);
  });

  it("passes a confirmation gate through as ok:true (a gate is not an error)", async () => {
    // withdraw is high-risk: without confirm the handler RETURNS a gate object.
    const res = await safeInvoke(
      verb("withdraw"),
      { action: "submit", coin: "USDT", address: "0xabc", amount: "1" },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.data as { confirmationRequired?: boolean }).confirmationRequired).toBe(true);
    }
  });

  it("NEVER throws across every tool in the full surface (called with empty args)", async () => {
    const results = await Promise.all(
      FULL.map(async (t): Promise<[string, SafeResult]> => [t.name, await safeInvoke(t, {}, ctx)]),
    );
    const notEnveloped = results.filter(([, r]) => typeof r.ok !== "boolean");
    expect(notEnveloped).toEqual([]);
    // sanity: the surface we swept is the real, non-trivial one
    expect(results.length).toBeGreaterThan(100);
  });
});
