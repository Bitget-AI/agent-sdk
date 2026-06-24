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

describe("write-safety: risk grading", () => {
  it("grades reads, writes, and high-risk operations", () => {
    expect(tool("getTickers").riskLevel).toBe("read");
    expect(tool("placeOrder").riskLevel).toBe("write");
    expect(tool("cancelAllOrders").riskLevel).toBe("high");
    expect(tool("closeAllPositions").riskLevel).toBe("high");
    expect(tool("withdrawal").riskLevel).toBe("high");
  });

  it("tags high-risk tools [DANGER] and advertises confirm in the schema", () => {
    const danger = tool("cancelAllOrders");
    expect(danger.description.startsWith("[DANGER]")).toBe(true);
    expect(danger.inputSchema.properties.confirm).toBeDefined();
    expect(danger.inputSchema.properties.dryRun).toBeDefined();
    // Reads do not carry the safety control params.
    expect(tool("getTickers").inputSchema.properties.dryRun).toBeUndefined();
  });
});

describe("write-safety: dry-run", () => {
  it("returns the would-send request without touching the network", async () => {
    const res = await tool("placeOrder").handler(
      {
        symbol: "BTCUSDT",
        category: "SPOT",
        side: "buy",
        orderType: "limit",
        price: "50000",
        qty: "0.001",
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
    // Control keys are stripped from the would-send payload.
    expect("dryRun" in wouldSend).toBe(false);
    expect("confirm" in wouldSend).toBe(false);

    // No order was actually placed.
    const open = await tool("getOpenOrders").handler({ category: "SPOT" }, ctx);
    expect((open.data as unknown[]).length).toBe(0);
  });
});

describe("write-safety: high-risk confirmation", () => {
  it("blocks a destructive op without confirm", async () => {
    const res = await tool("cancelAllOrders").handler({ category: "SPOT" }, ctx);
    const data = res.data as Record<string, unknown>;
    expect(data.confirmationRequired).toBe(true);
    expect(data.operationId).toBe("cancelAllOrders");
  });

  it("executes the destructive op when confirm: true", async () => {
    const res = await tool("cancelAllOrders").handler(
      { category: "SPOT", confirm: true },
      ctx,
    );
    const data = res.data as Record<string, unknown> | null;
    expect(data?.confirmationRequired).toBeUndefined();
    expect(typeof res.requestTime).toBe("string");
  });
});
