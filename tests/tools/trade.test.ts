import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockServer } from "@bitget-ai/bitget-agent-sdk/testing";
import { BitgetRestClient, buildTools, loadConfig } from "@bitget-ai/bitget-agent-sdk";
import type { ToolContext } from "@bitget-ai/bitget-agent-sdk";

let server: MockServer;
let ctx: ToolContext;

beforeAll(async () => {
  server = new MockServer();
  await server.start();
  process.env.BITGET_API_BASE_URL = server.baseUrl;
  process.env.BITGET_API_KEY = "key";
  process.env.BITGET_SECRET_KEY = "secret";
  process.env.BITGET_PASSPHRASE = "pass";
  const config = loadConfig({ modules: "all", surface: "full" });
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

function tool(name: string) {
  const found = buildTools(ctx.config).find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

describe("order lifecycle round-trip", () => {
  it("places, lists, inspects, and cancels an order", async () => {
    const placed = await tool("placeOrder").handler(
      { symbol: "BTCUSDT", category: "SPOT", side: "buy", orderType: "limit", price: "50000", qty: "0.001" },
      ctx,
    );
    const orderId = (placed.data as { orderId: string }).orderId;
    expect(orderId).toBeTruthy();

    const open = await tool("getOpenOrders").handler({ category: "SPOT" }, ctx);
    expect(Array.isArray(open.data)).toBe(true);
    expect((open.data as unknown[]).length).toBe(1);

    const details = await tool("getOrderDetails").handler({ orderId }, ctx);
    expect((details.data as { orderId: string }).orderId).toBe(orderId);

    await tool("cancelOrder").handler({ orderId }, ctx);
    const afterCancel = await tool("getOpenOrders").handler({ category: "SPOT" }, ctx);
    expect((afterCancel.data as unknown[]).length).toBe(0);
  });

  it("returns seeded account assets", async () => {
    const assets = await tool("getAccountAssets").handler({}, ctx);
    expect(Array.isArray(assets.data)).toBe(true);
    expect((assets.data as { coin: string }[]).some((b) => b.coin === "USDT")).toBe(true);
  });

  it("serves public tickers without credentials", async () => {
    const cfg = loadConfig({ modules: "market" });
    const publicClient = new BitgetRestClient({ ...cfg, hasAuth: false, apiKey: undefined, secretKey: undefined, passphrase: undefined });
    const res = await publicClient.callOperation("getTickers", { category: "SPOT", symbol: "BTCUSDT" });
    expect((res.data as { symbol: string }[])[0]?.symbol).toBe("BTCUSDT");
  });
});
