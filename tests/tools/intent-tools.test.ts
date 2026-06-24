import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockServer } from "@bitget-ai/bitget-agent-sdk/testing";
import { BitgetRestClient, buildTools, loadConfig } from "@bitget-ai/bitget-agent-sdk";
import type { ToolContext, ToolSpec } from "@bitget-ai/bitget-agent-sdk";

let server: MockServer;
let ctx: ToolContext;

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

beforeEach(() => server.reset());

function tool(name: string, config = ctx.config): ToolSpec {
  const found = buildTools(config).find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

function record(result: { data: unknown }): Record<string, unknown> {
  return result.data as Record<string, unknown>;
}

// The curated verbs visible under `modules: "all"`. The to-B verbs `broker`
// and `inst_loan` are intentionally absent — they live in HIDDEN_MODULES and
// surface only when their module is named explicitly (asserted below).
const ALL_VERBS = [
  "market",
  "order",
  "position",
  "strategy_order",
  "account_overview",
  "account_config",
  "repayment",
  "transfer_funds",
  "deposit",
  "withdraw",
  "funds_records",
  "subaccount",
  "loan",
  "tax",
];

describe("intent surface: presence", () => {
  it("exposes all 14 generally-available verbs + raw + discover when modules=all", () => {
    const names = new Set(buildTools(ctx.config).map((t) => t.name));
    for (const verb of [...ALL_VERBS, "raw", "discover"]) {
      expect(names.has(verb)).toBe(true);
    }
  });

  it("the intent surface is exactly the curated verbs + meta tools (no 1:1 tier, no hidden to-B)", () => {
    const names = buildTools(loadConfig({ modules: "all", surface: "intent" })).map((t) => t.name);
    expect(new Set(names)).toEqual(new Set([...ALL_VERBS, "raw", "discover"]));
    // the hidden to-B verbs are NOT discoverable under "all"
    expect(names).not.toContain("broker");
    expect(names).not.toContain("inst_loan");
  });
});

describe("intent surface: module gating", () => {
  it("gates each extended verb on its own module", () => {
    const only = (m: Parameters<typeof loadConfig>[0]) =>
      new Set(buildTools(loadConfig(m)).map((t) => t.name));

    const market = only({ modules: "market" });
    expect(market.has("market")).toBe(true);
    expect(market.has("order")).toBe(false);

    const trade = only({ modules: "trade" });
    expect(trade.has("strategy_order")).toBe(true);

    const account = only({ modules: "account" });
    for (const v of ["account_config", "repayment", "deposit", "withdraw", "funds_records", "subaccount"]) {
      expect(account.has(v)).toBe(true);
    }
    expect(account.has("broker")).toBe(false);

    expect(only({ modules: "broker" }).has("broker")).toBe(true);
    expect(only({ modules: "cryptoloans" }).has("loan")).toBe(true);
    expect(only({ modules: "instloan" }).has("inst_loan")).toBe(true);
    expect(only({ modules: "tax" }).has("tax")).toBe(true);
  });

  it("hides the to-B verbs by default — even under modules=all — and reveals them only when named", () => {
    const reveal = (m: Parameters<typeof loadConfig>[0]) =>
      new Set(buildTools(loadConfig(m)).map((t) => t.name));

    // "all" is the to-C surface: broker / inst_loan are hidden.
    const all = reveal({ modules: "all" });
    expect(all.has("broker")).toBe(false);
    expect(all.has("inst_loan")).toBe(false);

    // naming a hidden module explicitly is the opt-in to reveal it.
    expect(reveal({ modules: "broker" }).has("broker")).toBe(true);
    expect(reveal({ modules: "instloan" }).has("inst_loan")).toBe(true);
    // mixing a hidden module into an explicit list reveals just that one.
    const mixed = reveal({ modules: "account,broker" });
    expect(mixed.has("broker")).toBe(true);
    expect(mixed.has("inst_loan")).toBe(false);
  });
});

describe("action-tool builder: metadata", () => {
  it("read-only verbs are public-or-private reads, never surface-writes", () => {
    const market = tool("market");
    expect(market.auth).toBe("public");
    expect(market.isWrite).toBe(false);
    expect(market.riskLevel).toBe("read");
    expect(market.method).toBe("GET");

    const tax = tool("tax");
    expect(tax.riskLevel).toBe("read");

    // write-bearing verbs grade as write at the surface (per-op high-risk is
    // decided at execution, not here) and stay isWrite:false so reads survive readOnly.
    const loan = tool("loan");
    expect(loan.riskLevel).toBe("write");
    expect(loan.isWrite).toBe(false);
    expect(loan.method).toBe("POST");
  });

  it("advertises action enum, view, and (when writes exist) dryRun/confirm", () => {
    const props = tool("loan").inputSchema.properties as Record<string, unknown>;
    expect((props.action as { enum: string[] }).enum).toContain("borrow");
    expect(props.view).toBeDefined();
    expect(props.dryRun).toBeDefined();
    expect(props.confirm).toBeDefined();

    // a pure-read verb omits dryRun/confirm but still offers fetchAll for paged reads
    const taxProps = tool("tax").inputSchema.properties as Record<string, unknown>;
    expect(taxProps.dryRun).toBeUndefined();
    expect(taxProps.fetchAll).toBeDefined();
  });

  it("rejects an unknown action with a fixable error", async () => {
    await expect(tool("loan").handler({ action: "nope" }, ctx)).rejects.toThrow(/Invalid action/);
  });
});

describe("action-tool builder: dispatch", () => {
  it("routes a read action to its operation", async () => {
    server.setResponseOverride("getTickers", [{ symbol: "BTCUSDT", lastPr: "50000" }]);
    const res = await tool("market").handler({ action: "tickers", category: "SPOT" }, ctx);
    const rows = res.data as Record<string, unknown>[];
    expect(rows[0]?.symbol).toBe("BTCUSDT");
    expect(res.endpoint).toContain("/api/v3/market/tickers");
  });

  it("routes write actions to the right operation (dryRun, no network)", async () => {
    const cases: [string, string, Record<string, unknown>][] = [
      ["account_config", "setLeverage", { action: "setLeverage", category: "USDT-FUTURES", symbol: "BTCUSDT", leverage: "10" }],
      ["repayment", "repay", { action: "submit", coin: "USDT", amount: "5" }],
      ["deposit", "setUpDepositAccount", { action: "setupAccount" }],
      ["subaccount", "createSubAccount", { action: "create", username: "sub01" }],
      ["subaccount", "createAgentSubAccount", { action: "createAgent", username: "agent01", passphrase: "abcd1234" }],
      ["loan", "borrowCoins", { action: "borrow", coin: "USDT", amount: "100" }],
    ];
    for (const [verb, operationId, args] of cases) {
      const res = await tool(verb).handler({ ...args, dryRun: true }, ctx);
      const data = record(res);
      expect(data.dryRun).toBe(true);
      expect(data.operationId).toBe(operationId);
      // composite controls never leak onto the wire
      expect("action" in (data.wouldSend as Record<string, unknown>)).toBe(false);
    }
  });

  it("injects an auto clientOid for place/submit writes (P7)", async () => {
    const strat = await tool("strategy_order").handler(
      { action: "place", category: "USDT-FUTURES", symbol: "BTCUSDT", dryRun: true },
      ctx,
    );
    expect((record(strat).wouldSend as Record<string, unknown>).clientOid).toBeTruthy();

    const wd = await tool("withdraw").handler(
      { action: "submit", coin: "USDT", address: "0xabc", amount: "1", dryRun: true },
      ctx,
    );
    expect(record(wd).operationId).toBe("withdrawal");
    expect((record(wd).wouldSend as Record<string, unknown>).clientOid).toBeTruthy();
  });

  it("gates a high-risk write (withdrawal) behind confirm", async () => {
    const blocked = await tool("withdraw").handler(
      { action: "submit", coin: "USDT", address: "0xabc", amount: "1" },
      ctx,
    );
    expect(record(blocked).confirmationRequired).toBe(true);
    expect(record(blocked).operationId).toBe("withdrawal");
  });

  it("blocks writes under readOnly but keeps reads", async () => {
    const ro = loadConfig({ modules: "all", readOnly: true });
    const roCtx: ToolContext = { config: ro, client: new BitgetRestClient(ro) };
    await expect(
      tool("subaccount", ro).handler({ action: "create", username: "x" }, roCtx),
    ).rejects.toThrow(/readOnly/);
    // a read action on the same verb is unaffected
    const list = await tool("subaccount", ro).handler({ action: "list" }, roCtx);
    expect(typeof list.requestTime).toBe("string");
  });

  it("wires fetchAll for paged reads through the shared paginator", async () => {
    const pages = [[{ id: "1" }, { id: "2" }], [{ id: "3" }], []];
    let index = 0;
    const fake = {
      async callOperation() {
        const data = pages[index] ?? [];
        index += 1;
        return { endpoint: "GET /api/v3/account/financial-records", requestTime: "t", data, raw: {} };
      },
    };
    const fakeCtx = { config: ctx.config, client: fake as unknown as ToolContext["client"] };
    const res = await tool("funds_records").handler(
      { action: "financial", fetchAll: true },
      fakeCtx,
    );
    const data = record(res);
    expect((data.items as unknown[]).length).toBe(3);
    expect(data.pages).toBe(3);
    expect(data.truncated).toBe(false);
  });
});
