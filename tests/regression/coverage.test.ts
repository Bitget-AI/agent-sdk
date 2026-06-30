import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockServer } from "@bitget-ai/bitget-agent-sdk/testing";
import {
  BitgetRestClient,
  buildTools,
  loadConfig,
  CATALOG,
  CATALOG_OPERATION_COUNT,
  MODULES,
  getOperation,
  type CatalogOperation,
} from "@bitget-ai/bitget-agent-sdk";

// `modules: "all"` omits the hidden to-B modules by design; full-catalog
// coverage requires naming every module explicitly to reveal them.
const ALL_MODULES = MODULES.join(",");

let server: MockServer;
let client: BitgetRestClient;

beforeAll(async () => {
  server = new MockServer();
  await server.start();
  process.env.BITGET_API_BASE_URL = server.baseUrl;
  process.env.BITGET_API_KEY = "key";
  process.env.BITGET_SECRET_KEY = "secret";
  process.env.BITGET_PASSPHRASE = "pass";
  client = new BitgetRestClient(loadConfig({ modules: "all" }));
});

afterAll(async () => {
  delete process.env.BITGET_API_BASE_URL;
  delete process.env.BITGET_API_KEY;
  delete process.env.BITGET_SECRET_KEY;
  delete process.env.BITGET_PASSPHRASE;
  await server.stop();
});

function sampleArgs(op: CatalogOperation): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const fill = (name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes("category")) return "SPOT";
    if (lower.includes("symbol")) return "BTCUSDT";
    if (lower === "coin" || lower.includes("coin")) return "USDT";
    if (lower.includes("time")) return "1690000000000";
    if (lower.includes("uid")) return "123456";
    return "1";
  };
  for (const name of op.pathParams) args[name] = fill(name);
  for (const p of op.queryParams) if (p.required) args[p.name] = fill(p.name);
  return args;
}

describe("full-catalog regression coverage", () => {
  it("every spec operation has exactly one tool (all modules enabled)", () => {
    const tools = buildTools(loadConfig({ modules: ALL_MODULES, surface: "full" }));
    const generated = tools.filter((t) => t.module !== "core");
    expect(generated).toHaveLength(CATALOG_OPERATION_COUNT);
    const toolNames = new Set(tools.map((t) => t.name));
    for (const op of CATALOG) {
      expect(toolNames.has(op.operationId)).toBe(true);
    }
  });

  it("every tool's `fronts` resolve to real catalog operations", () => {
    const tools = buildTools(loadConfig({ modules: "all", surface: "full" }));
    const bad: string[] = [];
    for (const t of tools) {
      for (const id of t.fronts) {
        if (!getOperation(id)) bad.push(`${t.name} → ${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the intent surface's `fronts` cover EVERY catalog operation (zero capability loss)", () => {
    // The curated intent surface drops the 1:1 generated tier, so the union of
    // its tools' `fronts` must reach every catalog operation — otherwise
    // capability is silently lost. (`raw` still reaches anything, but coverage
    // must not depend on the escape hatch.) A new spec operation with no front
    // breaks here.
    const intent = buildTools(loadConfig({ modules: ALL_MODULES, surface: "intent" }));
    const covered = new Set<string>();
    for (const t of intent) {
      for (const id of t.fronts) covered.add(id);
    }
    const missing = CATALOG.map((o) => o.operationId).filter(
      (id) => !covered.has(id),
    );
    expect(missing).toEqual([]);
    // Every covered id is a real op (no strays), so the union is exactly the
    // full catalog.
    expect(covered.size).toBe(CATALOG_OPERATION_COUNT);
  });

  it("every operation round-trips through the mock with a 00000 envelope", async () => {
    const failures: string[] = [];
    for (const op of CATALOG) {
      try {
        const res = await client.callOperation(op.operationId, sampleArgs(op));
        if (typeof res.requestTime !== "string" || !res.endpoint.includes(op.path)) {
          failures.push(`${op.operationId}: malformed result`);
        }
      } catch (err) {
        failures.push(`${op.operationId}: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("rejects private operations when credentials are absent", async () => {
    const cfg = loadConfig({ modules: "all" });
    const anonymous = new BitgetRestClient({
      ...cfg,
      hasAuth: false,
      apiKey: undefined,
      secretKey: undefined,
      passphrase: undefined,
    });
    const privateOp = CATALOG.find((o) => o.auth === "private");
    expect(privateOp).toBeDefined();
    await expect(
      anonymous.callOperation(privateOp!.operationId, sampleArgs(privateOp!)),
    ).rejects.toThrow(/requires API credentials/);
  });

  it("public market operations need no credentials", async () => {
    const cfg = loadConfig({ modules: "market" });
    const publicClient = new BitgetRestClient({
      ...cfg,
      hasAuth: false,
      apiKey: undefined,
      secretKey: undefined,
      passphrase: undefined,
    });
    const publicOps = CATALOG.filter((o) => o.auth === "public");
    expect(publicOps.length).toBe(16);
    for (const op of publicOps) {
      const res = await publicClient.callOperation(op.operationId, sampleArgs(op));
      expect(res.raw.code).toBe("00000");
    }
  });
});
