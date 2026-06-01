import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { MockServer } from "bitget-agent-sdk/testing";
import { loadConfig, BitgetRestClient } from "bitget-agent-sdk";

let server: MockServer;

beforeAll(async () => {
  server = new MockServer();
  await server.start();
  process.env["BITGET_API_KEY"] = "test-key";
  process.env["BITGET_SECRET_KEY"] = "test-secret";
  process.env["BITGET_PASSPHRASE"] = "test-passphrase";
});

afterAll(() => server.stop());
afterEach(() => vi.restoreAllMocks());

describe("paper trading header", () => {
  test("does NOT send paptrading header when paperTrading=false", async () => {
    process.env["BITGET_API_BASE_URL"] = server.baseUrl;
    const config = loadConfig({ modules: "spot", readOnly: false, paperTrading: false });
    const client = new BitgetRestClient(config);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await client.publicGet("/api/v2/spot/market/tickers");
    const init = fetchSpy.mock.calls[0]?.[1];
    const sentHeaders = new Headers(init?.headers as HeadersInit);
    expect(sentHeaders.has("paptrading")).toBe(false);
  });

  test("sends paptrading: 1 header when paperTrading=true", async () => {
    process.env["BITGET_API_BASE_URL"] = server.baseUrl;
    const config = loadConfig({ modules: "spot", readOnly: false, paperTrading: true });
    const client = new BitgetRestClient(config);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await client.publicGet("/api/v2/spot/market/tickers");
    const init = fetchSpy.mock.calls[0]?.[1];
    const sentHeaders = new Headers(init?.headers as HeadersInit);
    expect(sentHeaders.get("paptrading")).toBe("1");
  });
});
