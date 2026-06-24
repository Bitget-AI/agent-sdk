import { afterEach, describe, expect, it, vi } from "vitest";
import { BitgetRestClient, loadConfig } from "@bitget-ai/bitget-agent-sdk";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BITGET_API_KEY;
  delete process.env.BITGET_SECRET_KEY;
  delete process.env.BITGET_PASSPHRASE;
});

function captureHeaders() {
  const calls: Headers[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    calls.push(new Headers(init?.headers));
    return jsonResponse({ code: "00000", msg: "success", data: { ok: true } });
  });
  return calls;
}

describe("paper trading + signing headers", () => {
  it("adds the paptrading header when paperTrading is enabled", async () => {
    process.env.BITGET_API_KEY = "key";
    process.env.BITGET_SECRET_KEY = "secret";
    process.env.BITGET_PASSPHRASE = "pass";
    const calls = captureHeaders();
    const client = new BitgetRestClient(loadConfig({ modules: "all", paperTrading: true }));
    await client.callOperation("placeOrder", { symbol: "BTCUSDT", side: "buy" });
    expect(calls[0]?.get("paptrading")).toBe("1");
    expect(calls[0]?.get("ACCESS-KEY")).toBe("key");
    expect(calls[0]?.get("ACCESS-SIGN")).toBeTruthy();
    expect(calls[0]?.get("ACCESS-TIMESTAMP")).toBeTruthy();
  });

  it("omits signing headers on public market endpoints", async () => {
    const calls = captureHeaders();
    const client = new BitgetRestClient(loadConfig({ modules: "all" }));
    await client.callOperation("getTickers", { category: "SPOT" });
    expect(calls[0]?.get("ACCESS-KEY")).toBeNull();
    expect(calls[0]?.get("paptrading")).toBeNull();
  });

  it("never sends paptrading on public endpoints even when paperTrading is enabled", async () => {
    // The Bitget demo env only hosts private endpoints; public market data
    // (e.g. proof-of-reserves, index-components) returns 404 under paptrading:1.
    const calls = captureHeaders();
    const client = new BitgetRestClient(loadConfig({ modules: "all", paperTrading: true }));
    await client.callOperation("getTickers", { category: "SPOT" });
    expect(calls[0]?.get("paptrading")).toBeNull();
    expect(calls[0]?.get("ACCESS-KEY")).toBeNull();
  });
});
