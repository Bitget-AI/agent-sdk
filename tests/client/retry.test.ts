import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BitgetRestClient,
  BitgetApiError,
  NetworkError,
  loadConfig,
} from "@bitget-ai/bitget-agent-sdk";
import type { CliOptions } from "@bitget-ai/bitget-agent-sdk";

const FAST_RETRY = { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 } as const;

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify({ code: "00000", msg: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonCode(code: string, msg = "error"): Response {
  return new Response(JSON.stringify({ code, msg, data: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response("{}", { status: code, headers });
}

/** Queue a sequence of responders; the last one repeats once exhausted. */
function stubFetch(responders: Array<() => Response | Promise<Response>>) {
  const calls: Headers[] = [];
  let i = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    calls.push(new Headers(init?.headers));
    const responder = responders[Math.min(i, responders.length - 1)];
    i += 1;
    return responder();
  });
  return {
    headers: calls,
    get count() {
      return i;
    },
  };
}

function authed(extra: CliOptions = {}): BitgetRestClient {
  return new BitgetRestClient(
    loadConfig({
      modules: "all",
      apiKey: "k",
      secretKey: "s",
      passphrase: "p",
      retry: FAST_RETRY,
      ...extra,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("transport retry", () => {
  it("retries an idempotent GET on 503, then succeeds", async () => {
    const retries: Array<Record<string, unknown>> = [];
    const fetchStub = stubFetch([() => status(503), () => jsonOk({ ok: true })]);
    const client = new BitgetRestClient(
      loadConfig({ modules: "all", retry: FAST_RETRY, hooks: { onRetry: (e) => retries.push(e) } }),
    );

    const res = await client.callOperation("getTickers", { category: "SPOT" });
    expect(fetchStub.count).toBe(2);
    expect(res.raw.code).toBe("00000");
    expect(retries).toHaveLength(1);
    expect(retries[0].reason).toBe("http-503");
    expect(retries[0].status).toBe(503);
  });

  it("retries on a network error, then succeeds", async () => {
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      n += 1;
      if (n < 3) throw new TypeError("network down");
      return jsonOk({ ok: true });
    });
    const retries: Array<Record<string, unknown>> = [];
    const client = new BitgetRestClient(
      loadConfig({ modules: "all", retry: FAST_RETRY, hooks: { onRetry: (e) => retries.push(e) } }),
    );

    const res = await client.callOperation("getTickers", { category: "SPOT" });
    expect(n).toBe(3);
    expect(res.raw.code).toBe("00000");
    expect(retries.map((r) => r.reason)).toEqual(["network-error", "network-error"]);
  });

  it("exhausts retries on persistent network errors → NetworkError, onError fires once", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("still down");
    });
    const errors: Array<Record<string, unknown>> = [];
    const client = new BitgetRestClient(
      loadConfig({ modules: "all", retry: FAST_RETRY, hooks: { onError: (e) => errors.push(e) } }),
    );

    await expect(client.callOperation("getTickers", { category: "SPOT" })).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].attempt).toBe(3); // 1 + maxRetries(2)
  });

  it("retries on 429 and respects the Retry-After header path", async () => {
    const retries: Array<Record<string, unknown>> = [];
    const fetchStub = stubFetch([
      () => status(429, { "Retry-After": "0" }),
      () => jsonOk({ ok: true }),
    ]);
    const client = new BitgetRestClient(
      loadConfig({ modules: "all", retry: FAST_RETRY, hooks: { onRetry: (e) => retries.push(e) } }),
    );

    const res = await client.callOperation("getTickers", { category: "SPOT" });
    expect(fetchStub.count).toBe(2);
    expect(res.raw.code).toBe("00000");
    expect(retries[0].reason).toBe("http-429");
    expect(retries[0].delayMs).toBe(0);
  });

  it("does NOT retry a non-idempotent POST (no clientOid) on 503", async () => {
    const fetchStub = stubFetch([() => status(503)]);
    const client = authed();
    await expect(
      client.callOperation("placeOrder", { symbol: "BTCUSDT", side: "buy" }),
    ).rejects.toBeInstanceOf(BitgetApiError);
    expect(fetchStub.count).toBe(1); // single attempt — never re-sent
  });

  it("DOES retry an idempotent POST (with clientOid) on 503", async () => {
    const fetchStub = stubFetch([() => status(503), () => jsonOk({ orderId: "1" })]);
    const client = authed();
    const res = await client.callOperation("placeOrder", {
      symbol: "BTCUSDT",
      side: "buy",
      clientOid: "oid-123",
    });
    expect(fetchStub.count).toBe(2);
    expect(res.raw.code).toBe("00000");
  });

  it("never retries an application-level error (code != 00000, HTTP 200)", async () => {
    const fetchStub = stubFetch([() => jsonCode("40034", "param error")]);
    const client = authed();
    await expect(
      client.callOperation("placeOrder", {
        symbol: "BTCUSDT",
        side: "buy",
        clientOid: "oid-1",
      }),
    ).rejects.toBeInstanceOf(BitgetApiError);
    expect(fetchStub.count).toBe(1); // business errors are deterministic — no retry
  });

  it("respects retry.maxRetries = 0 (retries disabled)", async () => {
    const fetchStub = stubFetch([() => status(503)]);
    const client = new BitgetRestClient(
      loadConfig({ modules: "all", retry: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 } }),
    );
    await expect(client.callOperation("getTickers", { category: "SPOT" })).rejects.toBeInstanceOf(
      BitgetApiError,
    );
    expect(fetchStub.count).toBe(1);
  });
});

describe("observability hooks + User-Agent", () => {
  it("fires onRequest/onResponse with 1-based attempt + status/code", async () => {
    stubFetch([() => jsonOk({ ok: true })]);
    const requests: Array<Record<string, unknown>> = [];
    const responses: Array<Record<string, unknown>> = [];
    const client = new BitgetRestClient(
      loadConfig({
        modules: "all",
        retry: FAST_RETRY,
        hooks: { onRequest: (e) => requests.push(e), onResponse: (e) => responses.push(e) },
      }),
    );

    await client.callOperation("getTickers", { category: "SPOT" });
    expect(requests).toHaveLength(1);
    expect(requests[0].attempt).toBe(1);
    expect(requests[0].endpoint).toBe("GET /api/v3/market/tickers");
    expect(responses).toHaveLength(1);
    expect(responses[0].status).toBe(200);
    expect(responses[0].code).toBe("00000");
  });

  it("a throwing hook never breaks the request", async () => {
    stubFetch([() => jsonOk({ ok: true })]);
    const client = new BitgetRestClient(
      loadConfig({
        modules: "all",
        retry: FAST_RETRY,
        hooks: {
          onRequest: () => {
            throw new Error("boom");
          },
        },
      }),
    );
    const res = await client.callOperation("getTickers", { category: "SPOT" });
    expect(res.raw.code).toBe("00000");
  });

  it("sets a User-Agent header on every request", async () => {
    const fetchStub = stubFetch([() => jsonOk({ ok: true })]);
    const client = new BitgetRestClient(loadConfig({ modules: "all", retry: FAST_RETRY }));
    await client.callOperation("getTickers", { category: "SPOT" });
    expect(fetchStub.headers[0]?.get("User-Agent")).toMatch(/^bitget-agent-sdk\/3\.0\.0/);
  });

  it("honors a custom userAgent override", async () => {
    const fetchStub = stubFetch([() => jsonOk({ ok: true })]);
    const client = new BitgetRestClient(
      loadConfig({ modules: "all", retry: FAST_RETRY, userAgent: "bitget-agent-cli/9.9.9" }),
    );
    await client.callOperation("getTickers", { category: "SPOT" });
    expect(fetchStub.headers[0]?.get("User-Agent")).toBe("bitget-agent-cli/9.9.9");
  });
});
