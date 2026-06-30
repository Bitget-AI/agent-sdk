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

describe("composite tier: module gating", () => {
  it("exposes all four verbs when modules=all", () => {
    const names = new Set(buildTools(ctx.config).map((t) => t.name));
    for (const verb of ["order", "position", "account_overview", "transfer_funds"]) {
      expect(names.has(verb)).toBe(true);
    }
  });

  it("omits all composites when only market is enabled", () => {
    const names = new Set(buildTools(loadConfig({ modules: "market" })).map((t) => t.name));
    for (const verb of ["order", "position", "account_overview", "transfer_funds"]) {
      expect(names.has(verb)).toBe(false);
    }
  });

  it("gates each composite on its primary module", () => {
    const trade = new Set(buildTools(loadConfig({ modules: "trade" })).map((t) => t.name));
    expect(trade.has("order")).toBe(true);
    expect(trade.has("position")).toBe(true);
    expect(trade.has("account_overview")).toBe(false);
    expect(trade.has("transfer_funds")).toBe(false);

    const account = new Set(buildTools(loadConfig({ modules: "account" })).map((t) => t.name));
    expect(account.has("account_overview")).toBe(true);
    expect(account.has("transfer_funds")).toBe(true);
    expect(account.has("order")).toBe(false);
  });

  it("composites are non-write at the surface so they survive readOnly", () => {
    const names = new Set(
      buildTools(loadConfig({ modules: "all", readOnly: true })).map((t) => t.name),
    );
    expect(names.has("order")).toBe(true);
    expect(names.has("transfer_funds")).toBe(true);
  });
});

describe("composite order: lifecycle + routing", () => {
  it("advertises the v3 `qty` quantity field (not `size`) on its schema", () => {
    const props = (tool("order").inputSchema as { properties: Record<string, unknown> })
      .properties;
    expect(props.qty).toBeDefined();
    expect(props.size).toBeUndefined();
  });

  it("merges the catalog body type onto a hand-authored field (qty → string)", () => {
    // order.ts authors qty with an intent-tuned description but no type; the
    // catalog projection must supply type:"string" through mergeProjected, so a
    // strict consumer sees the scalar type even on the curated intent face.
    const props = (tool("order").inputSchema as { properties: Record<string, { type?: string }> })
      .properties;
    expect(props.qty.type).toBe("string");
    expect(props.price.type).toBe("string");
  });

  it("places a single order and auto-injects a clientOid (P7)", async () => {
    const placed = await tool("order").handler(
      { action: "place", symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "50000", qty: "0.001" },
      ctx,
    );
    const data = record(placed);
    expect(data.orderId).toBeTruthy();
    // The mock echoes the clientOid it received → proves injection reached the wire.
    expect(typeof data.clientOid).toBe("string");
    expect((data.clientOid as string).length).toBeGreaterThan(0);
  });

  it("lists, inspects via detail, and cancels", async () => {
    const placed = await tool("order").handler(
      { action: "place", symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "50000", qty: "0.001" },
      ctx,
    );
    const orderId = record(placed).orderId as string;

    const open = await tool("order").handler({ action: "open", category: "SPOT" }, ctx);
    expect((open.data as unknown[]).length).toBe(1);

    const detail = await tool("order").handler({ action: "detail", orderId }, ctx);
    expect((detail.data as { orderId: string }).orderId).toBe(orderId);

    await tool("order").handler({ action: "cancel", orderId }, ctx);
    const after = await tool("order").handler({ action: "open", category: "SPOT" }, ctx);
    expect((after.data as unknown[]).length).toBe(0);
  });

  it("routes to the batch endpoint when an orders array is present", async () => {
    const res = await tool("order").handler(
      {
        action: "place",
        orders: [
          { symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "50000", qty: "0.001" },
          { symbol: "ETHUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "3000", qty: "0.01" },
        ],
      },
      ctx,
    );
    const data = record(res);
    expect(Array.isArray(data.successList)).toBe(true);
    expect((data.successList as unknown[]).length).toBe(2);
  });

  it("gates cancelAll behind confirm and executes with confirm:true", async () => {
    const blocked = await tool("order").handler({ action: "cancelAll", category: "SPOT" }, ctx);
    expect(record(blocked).confirmationRequired).toBe(true);
    expect(record(blocked).operationId).toBe("cancelAllOrders");

    const done = await tool("order").handler({ action: "cancelAll", category: "SPOT", confirm: true }, ctx);
    expect(record(done).confirmationRequired).toBeUndefined();
    expect(typeof done.requestTime).toBe("string");
  });

  it("previews a write with dryRun without touching state", async () => {
    const preview = await tool("order").handler(
      { action: "place", symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "50000", qty: "0.001", dryRun: true },
      ctx,
    );
    const data = record(preview);
    expect(data.dryRun).toBe(true);
    expect(data.operationId).toBe("placeOrder");
    const wouldSend = data.wouldSend as Record<string, unknown>;
    expect(wouldSend.clientOid).toBeTruthy();
    expect("dryRun" in wouldSend).toBe(false);
    // Regression: the verb forwards the v3 `qty` field verbatim — never `size`
    // (every order write op uses `qty`; the lenient mock previously hid this).
    expect(wouldSend.qty).toBe("0.001");
    expect("size" in wouldSend).toBe(false);

    const open = await tool("order").handler({ action: "open", category: "SPOT" }, ctx);
    expect((open.data as unknown[]).length).toBe(0);
  });

  it("returns order history as a normalized list", async () => {
    await tool("order").handler(
      { action: "place", symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "50000", qty: "0.001" },
      ctx,
    );
    const history = await tool("order").handler({ action: "history", category: "SPOT" }, ctx);
    expect(Array.isArray(history.data)).toBe(true);
    expect((history.data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

describe("composite order: fetchAll wiring (fake client)", () => {
  it("walks the cursor and returns { items, pages, truncated }", async () => {
    const pages = [
      [{ orderId: "1" }, { orderId: "2" }],
      [{ orderId: "3" }],
      [],
    ];
    let index = 0;
    const fake = {
      async callOperation() {
        const data = pages[index] ?? [];
        index += 1;
        return { endpoint: "GET /api/v3/trade/history-orders", requestTime: "t", data, raw: {} };
      },
    };
    const fakeCtx = {
      config: ctx.config,
      client: fake as unknown as ToolContext["client"],
    };
    const res = await tool("order").handler(
      { action: "history", category: "SPOT", fetchAll: true },
      fakeCtx,
    );
    const data = record(res);
    expect((data.items as unknown[]).length).toBe(3);
    expect(data.pages).toBe(3);
    expect(data.truncated).toBe(false);
  });
});

describe("composite order: readOnly self-guard", () => {
  it("blocks a write action under readOnly but allows dryRun and reads", async () => {
    const roConfig = loadConfig({ modules: "all", readOnly: true });
    const roCtx: ToolContext = { config: roConfig, client: new BitgetRestClient(roConfig) };

    await expect(
      tool("order", roConfig).handler(
        { action: "place", symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "50000", qty: "0.001" },
        roCtx,
      ),
    ).rejects.toThrow(/readOnly/);

    // dryRun preview is still allowed in readOnly.
    const preview = await tool("order", roConfig).handler(
      { action: "place", symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "1", qty: "1", dryRun: true },
      roCtx,
    );
    expect(record(preview).dryRun).toBe(true);

    // reads are unaffected.
    const open = await tool("order", roConfig).handler({ action: "open", category: "SPOT" }, roCtx);
    expect(Array.isArray(open.data)).toBe(true);
  });
});

describe("composite position", () => {
  it("reads current positions (normalized)", async () => {
    server.setResponseOverride("getPositionInfo", [
      { symbol: "BTCUSDT", category: "USDT-FUTURES", total: "1", unrealizedPL: null },
    ]);
    const res = await tool("position").handler(
      { action: "info", category: "USDT-FUTURES" },
      ctx,
    );
    const rows = res.data as Record<string, unknown>[];
    expect(rows[0].symbol).toBe("BTCUSDT");
    // summary view trims the null field.
    expect("unrealizedPL" in rows[0]).toBe(false);
  });

  it("gates closeAll behind confirm", async () => {
    const blocked = await tool("position").handler(
      { action: "closeAll", category: "USDT-FUTURES", symbol: "BTCUSDT" },
      ctx,
    );
    expect(record(blocked).confirmationRequired).toBe(true);
    expect(record(blocked).operationId).toBe("closeAllPositions");

    const done = await tool("position").handler(
      { action: "closeAll", category: "USDT-FUTURES", symbol: "BTCUSDT", confirm: true },
      ctx,
    );
    expect(record(done).confirmationRequired).toBeUndefined();
  });

  it("close requires a symbol so it can never flatten the whole category by omission", async () => {
    await expect(
      tool("position").handler({ action: "close", category: "USDT-FUTURES" }, ctx),
    ).rejects.toThrow(/symbol/i);
  });

  it("close gates the single-position close behind confirm (high-risk), then proceeds", async () => {
    const blocked = await tool("position").handler(
      { action: "close", category: "USDT-FUTURES", symbol: "BTCUSDT" },
      ctx,
    );
    expect(record(blocked).confirmationRequired).toBe(true);
    expect(record(blocked).operationId).toBe("closeAllPositions");

    const done = await tool("position").handler(
      { action: "close", category: "USDT-FUTURES", symbol: "BTCUSDT", confirm: true },
      ctx,
    );
    expect(record(done).confirmationRequired).toBeUndefined();
  });
});

describe("composite account_overview", () => {
  it("fans out to account reads with per-section ok flags", async () => {
    const res = await tool("account_overview").handler(
      { category: "USDT-FUTURES", symbol: "BTCUSDT" },
      ctx,
    );
    const data = record(res);
    for (const key of ["assets", "settings", "fundingAssets", "positions", "feeRate"]) {
      expect(data[key]).toBeDefined();
      expect((data[key] as { ok: boolean }).ok).toBe(true);
    }
    const assets = (data.assets as { data: unknown }).data;
    expect(Array.isArray(assets)).toBe(true);
  });

  it("omits position/fee sections when no category is given", async () => {
    const res = await tool("account_overview").handler({}, ctx);
    const data = record(res);
    expect(data.assets).toBeDefined();
    expect(data.settings).toBeDefined();
    expect(data.fundingAssets).toBeDefined();
    expect(data.positions).toBeUndefined();
    expect(data.feeRate).toBeUndefined();
  });
});

describe("composite transfer_funds", () => {
  it("previews an internal transfer via dryRun", async () => {
    const res = await tool("transfer_funds").handler(
      { action: "internal", coin: "USDT", amount: "10", fromType: "spot", toType: "unified", dryRun: true },
      ctx,
    );
    const data = record(res);
    expect(data.dryRun).toBe(true);
    expect(data.operationId).toBe("transfer");
    expect((data.wouldSend as Record<string, unknown>).coin).toBe("USDT");
  });

  it("routes by action and injects clientOid for sub transfers", async () => {
    const main = await tool("transfer_funds").handler(
      { action: "mainToSub", coin: "USDT", amount: "10", fromUserId: "1", toUserId: "2", dryRun: true },
      ctx,
    );
    expect(record(main).operationId).toBe("mainSubAccountTransfer");
    expect((record(main).wouldSend as Record<string, unknown>).clientOid).toBeTruthy();

    const sub = await tool("transfer_funds").handler(
      { action: "subToMain", coin: "USDT", amount: "10", dryRun: true },
      ctx,
    );
    expect(record(sub).operationId).toBe("subMainAccountTransfer");
  });

  it("preflight reports max transferable without transferring", async () => {
    server.setResponseOverride("getMaxTransferable", { coin: "USDT", maxTransferable: "123.45" });
    const res = await tool("transfer_funds").handler(
      { action: "internal", coin: "USDT", preflight: true },
      ctx,
    );
    const data = record(res);
    expect(data.maxTransferable).toBe("123.45");
    expect(data.dryRun).toBeUndefined();
  });

  it("blocks a real transfer under readOnly", async () => {
    const roConfig = loadConfig({ modules: "all", readOnly: true });
    const roCtx: ToolContext = { config: roConfig, client: new BitgetRestClient(roConfig) };
    await expect(
      tool("transfer_funds", roConfig).handler(
        { action: "internal", coin: "USDT", amount: "10", fromType: "spot", toType: "unified" },
        roCtx,
      ),
    ).rejects.toThrow(/readOnly/);
  });
});
