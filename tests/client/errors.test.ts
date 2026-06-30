import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockServer } from "@bitget-ai/bitget-agent-sdk/testing";
import {
  BitgetRestClient,
  loadConfig,
  AuthenticationError,
  BitgetApiError,
} from "@bitget-ai/bitget-agent-sdk";

let server: MockServer;

beforeAll(async () => {
  server = new MockServer();
  await server.start();
  process.env.BITGET_API_BASE_URL = server.baseUrl;
});

afterAll(async () => {
  delete process.env.BITGET_API_BASE_URL;
  await server.stop();
});

beforeEach(() => {
  server.reset();
});

function authedClient(): BitgetRestClient {
  process.env.BITGET_API_KEY = "key";
  process.env.BITGET_SECRET_KEY = "secret";
  process.env.BITGET_PASSPHRASE = "pass";
  return new BitgetRestClient(loadConfig({ modules: "all" }));
}

describe("rest client error handling", () => {
  it("maps a Bitget error code to BitgetApiError", async () => {
    server.setErrorOverride("POST", "/api/v3/trade/place-order", "40034", "param error");
    const client = authedClient();
    await expect(
      client.callOperation("placeOrder", { symbol: "BTCUSDT", side: "buy" }),
    ).rejects.toBeInstanceOf(BitgetApiError);
  });

  it("maps auth code 40017 to AuthenticationError", async () => {
    server.setErrorOverride("GET", "/api/v3/account/assets", "40017", "Invalid API key");
    const client = authedClient();
    await expect(client.callOperation("getAccountAssets")).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("rejects private calls without credentials", async () => {
    delete process.env.BITGET_API_KEY;
    delete process.env.BITGET_SECRET_KEY;
    delete process.env.BITGET_PASSPHRASE;
    const client = new BitgetRestClient(loadConfig({ modules: "all" }));
    await expect(client.callOperation("getAccountAssets")).rejects.toThrow(
      /requires API credentials/,
    );
  });

  it("rejects an unknown operationId", async () => {
    const client = authedClient();
    await expect(client.callOperation("nopeNotReal")).rejects.toThrow(/Unknown operationId/);
  });
});
