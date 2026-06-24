// Zero-dependency verification harness (node:test) that mirrors the vitest
// suite. Used to prove the SDK green in environments where the pnpm install
// cannot complete (offline). It runs against the COMPILED package in lib/.
//
// Build then run:  ./node_modules/.bin/tsc  &&  node --test verify/smoke.test.mjs
//
// It mirrors the canonical vitest coverage on two levels:
//   • catalog + client transport/auth (design-independent foundation), and
//   • the intent surface that is now the DEFAULT (16 verbs + raw + discover),
//     including the zero-capability-loss invariant and action dispatch.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  BitgetRestClient,
  buildTools,
  loadConfig,
  CATALOG,
  CATALOG_OPERATION_COUNT,
  MODULES,
} from "../lib/src/index.js";
import { MockServer } from "../lib/src/testing/index.js";

let server;
let ctx; // { config, client } pointed at the mock — drives intent handlers

before(async () => {
  server = new MockServer();
  await server.start();
  process.env.BITGET_API_BASE_URL = server.baseUrl;
  process.env.BITGET_API_KEY = "key";
  process.env.BITGET_SECRET_KEY = "secret";
  process.env.BITGET_PASSPHRASE = "pass";
  const config = loadConfig({ modules: "all" });
  ctx = { config, client: new BitgetRestClient(config) };
});

after(async () => {
  await server.stop();
});

beforeEach(() => server.reset());

function sampleArgs(op) {
  const args = {};
  const fill = (name) => {
    const l = name.toLowerCase();
    if (l.includes("category")) return "SPOT";
    if (l.includes("symbol")) return "BTCUSDT";
    if (l.includes("coin")) return "USDT";
    if (l.includes("time")) return "1690000000000";
    if (l.includes("uid")) return "123456";
    return "1";
  };
  for (const name of op.pathParams) args[name] = fill(name);
  for (const p of op.queryParams) if (p.required) args[p.name] = fill(p.name);
  return args;
}

const names = (cfg) => new Set(buildTools(cfg).map((t) => t.name));

function tool(name, cfg = ctx.config) {
  const found = buildTools(cfg).find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

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
  "broker",
  "loan",
  "inst_loan",
  "tax",
];

// ── A. catalog integrity (single source of truth) ───────────────────────────

test("catalog has 109 operations", () => {
  assert.equal(CATALOG.length, 109);
  assert.equal(CATALOG_OPERATION_COUNT, 109);
});

test("every catalog module is a known ModuleId", () => {
  const known = new Set(MODULES);
  for (const op of CATALOG) assert.ok(known.has(op.module), op.module);
});

// ── B. client transport & auth (design-independent foundation) ──────────────

test("ALL 109 operations round-trip through the mock with code 00000", async () => {
  const client = new BitgetRestClient(loadConfig({ modules: "all" }));
  const failures = [];
  for (const op of CATALOG) {
    try {
      const res = await client.callOperation(op.operationId, sampleArgs(op));
      if (res.raw.code !== "00000" || !res.endpoint.includes(op.path)) {
        failures.push(`${op.operationId}: code=${res.raw.code}`);
      }
    } catch (err) {
      failures.push(`${op.operationId}: ${err.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("16 public market ops succeed without credentials", async () => {
  const cfg = loadConfig({ modules: "market" });
  const pub = new BitgetRestClient({
    ...cfg,
    hasAuth: false,
    apiKey: undefined,
    secretKey: undefined,
    passphrase: undefined,
  });
  const publicOps = CATALOG.filter((o) => o.auth === "public");
  assert.equal(publicOps.length, 16);
  for (const op of publicOps) {
    const res = await pub.callOperation(op.operationId, sampleArgs(op));
    assert.equal(res.raw.code, "00000");
  }
});

test("private op without credentials is rejected client-side", async () => {
  const cfg = loadConfig({ modules: "all" });
  const anon = new BitgetRestClient({
    ...cfg,
    hasAuth: false,
    apiKey: undefined,
    secretKey: undefined,
    passphrase: undefined,
  });
  const op = CATALOG.find((o) => o.auth === "private");
  await assert.rejects(
    () => anon.callOperation(op.operationId, sampleArgs(op)),
    /requires API credentials/,
  );
});

test("order lifecycle: place -> list -> details -> cancel", async () => {
  const client = new BitgetRestClient(loadConfig({ modules: "all" }));
  const placed = await client.callOperation("placeOrder", {
    symbol: "BTCUSDT",
    category: "SPOT",
    side: "buy",
    orderType: "limit",
    price: "50000",
    size: "0.001",
  });
  const orderId = placed.data.orderId;
  assert.ok(orderId);

  const open = await client.callOperation("getOpenOrders", { category: "SPOT" });
  assert.equal(open.data.length, 1);

  const details = await client.callOperation("getOrderDetails", { orderId });
  assert.equal(details.data.orderId, orderId);

  await client.callOperation("cancelOrder", { orderId });
  const after = await client.callOperation("getOpenOrders", { category: "SPOT" });
  assert.equal(after.data.length, 0);
});

test("error override maps to BitgetApiError", async () => {
  server.setErrorOverride("POST", "/api/v3/trade/place-order", "40034", "param error");
  const client = new BitgetRestClient(loadConfig({ modules: "all" }));
  await assert.rejects(
    () => client.callOperation("placeOrder", { symbol: "BTCUSDT", side: "buy" }),
    (err) => err.type === "BitgetApiError" && err.code === "40034",
  );
});

test("paperTrading sets paptrading + signing headers; public omits them", async () => {
  const realFetch = globalThis.fetch;
  const captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ code: "00000", msg: "success", data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const signed = new BitgetRestClient(loadConfig({ modules: "all", paperTrading: true }));
    await signed.callOperation("placeOrder", { symbol: "BTCUSDT", side: "buy" });
    assert.equal(captured[0].get("paptrading"), "1");
    assert.ok(captured[0].get("ACCESS-KEY"));
    assert.ok(captured[0].get("ACCESS-SIGN"));

    captured.length = 0;
    const pubCfg = loadConfig({ modules: "market" });
    const pub = new BitgetRestClient({ ...pubCfg, hasAuth: false, apiKey: undefined, secretKey: undefined, passphrase: undefined });
    await pub.callOperation("getTickers", { category: "SPOT" });
    assert.equal(captured[0].get("ACCESS-KEY"), null);
    assert.equal(captured[0].get("paptrading"), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── C. intent surface — shape & module gating (now the DEFAULT) ─────────────

test("default surface is intent", () => {
  assert.equal(loadConfig().surface, "intent");
  assert.equal(loadConfig({ modules: "all" }).surface, "intent");
});

test("intent (default) = exactly the 16 verbs + raw + discover, all core-module", () => {
  const tools = buildTools(loadConfig({ modules: "all" }));
  assert.deepEqual(
    new Set(tools.map((t) => t.name)),
    new Set([...ALL_VERBS, "raw", "discover"]),
  );
  // the 1:1 generated tier must NOT leak into the intent surface
  assert.ok(tools.every((t) => t.module === "core"));
  assert.equal(tools.find((t) => t.name === "placeOrder"), undefined);
  // names stay unique
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
});

test("surface=full ALSO emits the 1:1 generated tier (one per op) + curated tools", () => {
  const tools = buildTools(loadConfig({ modules: "all", surface: "full" }));
  const generated = tools.filter((t) => t.module !== "core");
  assert.equal(generated.length, CATALOG_OPERATION_COUNT);
  const set = new Set(tools.map((t) => t.name));
  // a sample of generated 1:1 tools is present…
  assert.ok(set.has("placeOrder"));
  assert.ok(set.has("getTickers"));
  // …alongside the curated core verbs + meta tools
  for (const n of [...ALL_VERBS, "raw", "discover"]) assert.ok(set.has(n), n);
  // full is strictly larger than intent, names still unique
  assert.ok(tools.length > buildTools(loadConfig({ modules: "all", surface: "intent" })).length);
  assert.equal(set.size, tools.length);
});

test("intent surface gates each extended verb on its own module", () => {
  const market = names(loadConfig({ modules: "market" }));
  assert.ok(market.has("market"));
  assert.ok(!market.has("order"));

  assert.ok(names(loadConfig({ modules: "trade" })).has("strategy_order"));

  const account = names(loadConfig({ modules: "account" }));
  for (const v of ["account_config", "repayment", "deposit", "withdraw", "funds_records", "subaccount"]) {
    assert.ok(account.has(v), v);
  }
  assert.ok(!account.has("broker"));

  assert.ok(names(loadConfig({ modules: "broker" })).has("broker"));
  assert.ok(names(loadConfig({ modules: "cryptoloans" })).has("loan"));
  assert.ok(names(loadConfig({ modules: "instloan" })).has("inst_loan"));
  assert.ok(names(loadConfig({ modules: "tax" })).has("tax"));
});

test("loadConfig rejects an unknown surface", () => {
  assert.throws(() => loadConfig({ surface: "wide" }), /Unknown surface/);
});

// ── D. zero capability loss (the key new-op regression) ─────────────────────
// The intent surface drops the 1:1 tier, so the union of every verb's `fronts`
// must still reach EVERY catalog op. A new spec op with no front breaks here —
// this is what guards createAgentSubAccount (and any future op) from silently
// dropping out of the curated surface.

test("intent `fronts` union covers EVERY catalog op (zero capability loss)", () => {
  const intent = buildTools(loadConfig({ modules: "all", surface: "intent" }));
  const covered = new Set();
  for (const t of intent) for (const id of t.fronts) covered.add(id);
  const missing = CATALOG.map((o) => o.operationId).filter((id) => !covered.has(id));
  assert.deepEqual(missing, []);
  assert.equal(covered.size, CATALOG_OPERATION_COUNT);
  // explicit: the new op is reachable via the subaccount verb
  assert.ok(covered.has("createAgentSubAccount"));
});

test("every tool's `fronts` resolve to real catalog operations", () => {
  const ids = new Set(CATALOG.map((o) => o.operationId));
  const bad = [];
  for (const t of buildTools(loadConfig({ modules: "all", surface: "full" }))) {
    for (const id of t.fronts) if (!ids.has(id)) bad.push(`${t.name} → ${id}`);
  }
  assert.deepEqual(bad, []);
});

// ── E. progressive discovery (discover meta-tool) ───────────────────────────

test("discover({}) lists business domains + holds meta(raw,discover) apart", async () => {
  const res = await tool("discover").handler({}, ctx);
  const domains = res.data.domains.map((d) => d.domain);
  assert.ok(domains.includes("market"));
  assert.ok(domains.includes("trade"));
  assert.ok(!domains.includes("meta")); // meta is never a business domain
  assert.ok(!domains.includes("core"));
  assert.ok(res.data.meta.includes("discover"));
  assert.ok(res.data.meta.includes("raw"));
});

test("discover({domain}) lists tools; discover({tool}) returns schema + fronts", async () => {
  const byDomain = await tool("discover").handler({ domain: "trade" }, ctx);
  const dn = byDomain.data.tools.map((t) => t.name);
  assert.ok(dn.includes("order"));
  assert.ok(dn.includes("position"));

  const byTool = await tool("discover").handler({ tool: "order" }, ctx);
  assert.equal(byTool.data.name, "order");
  assert.equal(byTool.data.domain, "trade");
  assert.equal(byTool.data.inputSchema.type, "object");
  assert.ok(byTool.data.fronts.includes("placeOrder"));

  await assert.rejects(() => tool("discover").handler({ tool: "nope" }, ctx), /Unknown tool/);
});

// ── F. action dispatch + write safety (incl. the new createAgent feature) ───

test("a read action routes to its operation endpoint", async () => {
  const res = await tool("market").handler({ action: "tickers", category: "SPOT" }, ctx);
  assert.ok(res.endpoint.includes("/api/v3/market/tickers"));
});

test("write actions dryRun-preview the right op; controls never hit the wire", async () => {
  const cases = [
    ["subaccount", "createSubAccount", { action: "create", username: "sub01" }],
    // the NEW op: Create Agent Sub-account, wired as subaccount→createAgent
    ["subaccount", "createAgentSubAccount", { action: "createAgent", username: "agent01", passphrase: "abcd1234" }],
    ["account_config", "setLeverage", { action: "setLeverage", category: "USDT-FUTURES", symbol: "BTCUSDT", leverage: "10" }],
    ["loan", "borrowCoins", { action: "borrow", coin: "USDT", amount: "100" }],
  ];
  for (const [verb, operationId, args] of cases) {
    const res = await tool(verb).handler({ ...args, dryRun: true }, ctx);
    assert.equal(res.data.dryRun, true, `${verb} dryRun`);
    assert.equal(res.data.operationId, operationId, `${verb} → ${operationId}`);
    assert.ok(!("action" in res.data.wouldSend), `${verb} leaks action`);
  }
});

test("an unknown action fails with a fixable error", async () => {
  await assert.rejects(() => tool("loan").handler({ action: "nope" }, ctx), /Invalid action/);
});

test("high-risk withdrawal is gated behind confirm", async () => {
  const blocked = await tool("withdraw").handler(
    { action: "submit", coin: "USDT", address: "0xabc", amount: "1" },
    ctx,
  );
  assert.equal(blocked.data.confirmationRequired, true);
  assert.equal(blocked.data.operationId, "withdrawal");
});

test("readOnly blocks a write action but keeps reads", async () => {
  const ro = loadConfig({ modules: "all", readOnly: true });
  const roCtx = { config: ro, client: new BitgetRestClient(ro) };
  await assert.rejects(
    () => tool("subaccount", ro).handler({ action: "create", username: "x" }, roCtx),
    /readOnly/,
  );
  const list = await tool("subaccount", ro).handler({ action: "list" }, roCtx);
  assert.equal(typeof list.requestTime, "string");
});
