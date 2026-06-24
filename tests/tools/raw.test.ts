import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

function rawTool(config = ctx.config) {
  const found = buildTools(config).find((t) => t.name === "raw");
  if (!found) throw new Error("raw tool not found");
  return found;
}

describe("raw passthrough escape hatch", () => {
  it("is always present in the tool surface", () => {
    expect(buildTools(ctx.config).some((t) => t.name === "raw")).toBe(true);
    expect(rawTool().inputSchema.required).toContain("operationId");
  });

  it("invokes any catalog operation by id", async () => {
    const res = await rawTool().handler(
      { operationId: "getTickers", args: { category: "SPOT", symbol: "BTCUSDT" } },
      ctx,
    );
    expect(res.endpoint).toContain("/api/v3/market/tickers");
    expect((res.data as { symbol: string }[])[0]?.symbol).toBe("BTCUSDT");
  });

  it("rejects an unknown operationId", async () => {
    await expect(
      rawTool().handler({ operationId: "nopeNotReal" }, ctx),
    ).rejects.toThrow(/Unknown operationId/);
  });

  it("rejects a missing operationId", async () => {
    await expect(rawTool().handler({}, ctx)).rejects.toThrow(
      /Missing required parameter "operationId"/,
    );
  });

  it("refuses write operations when readOnly is enabled", async () => {
    const roConfig = loadConfig({ modules: "all", readOnly: true });
    const roCtx: ToolContext = {
      config: roConfig,
      client: new BitgetRestClient(roConfig),
    };
    await expect(
      rawTool(roConfig).handler(
        { operationId: "placeOrder", args: { symbol: "BTCUSDT", side: "buy" } },
        roCtx,
      ),
    ).rejects.toThrow(/readOnly/);
  });
});

describe("raw routes through the safety gate (no bypass)", () => {
  it("advertises the dryRun + confirm controls in its schema", () => {
    const schema = rawTool().inputSchema;
    expect(schema.properties.dryRun).toBeDefined();
    expect(schema.properties.confirm).toBeDefined();
  });

  it("blocks a high-risk op invoked via raw when confirm is absent", async () => {
    const res = await rawTool().handler(
      { operationId: "cancelAllOrders", args: { category: "SPOT" } },
      ctx,
    );
    const data = res.data as Record<string, unknown>;
    // The escape hatch must NOT let an agent sidestep the confirm gate.
    expect(data.confirmationRequired).toBe(true);
    expect(data.operationId).toBe("cancelAllOrders");
  });

  it("executes the high-risk op via raw when confirm: true", async () => {
    const res = await rawTool().handler(
      { operationId: "cancelAllOrders", args: { category: "SPOT" }, confirm: true },
      ctx,
    );
    const data = res.data as Record<string, unknown> | null;
    expect(data?.confirmationRequired).toBeUndefined();
    expect(typeof res.requestTime).toBe("string");
  });

  it("previews via dryRun without touching the network, stripping control keys", async () => {
    const res = await rawTool().handler(
      {
        operationId: "placeOrder",
        args: {
          symbol: "BTCUSDT",
          category: "SPOT",
          side: "buy",
          orderType: "limit",
          price: "50000",
          qty: "0.001",
        },
        dryRun: true,
      },
      ctx,
    );
    const data = res.data as Record<string, unknown>;
    expect(data.dryRun).toBe(true);
    expect(data.operationId).toBe("placeOrder");
    const wouldSend = data.wouldSend as Record<string, unknown>;
    expect(wouldSend.symbol).toBe("BTCUSDT");
    expect(wouldSend.qty).toBe("0.001");
    // Reserved controls never reach the wire payload.
    expect("dryRun" in wouldSend).toBe(false);
    expect("confirm" in wouldSend).toBe(false);
  });
});
