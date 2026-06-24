import { describe, expect, it } from "vitest";
import {
  FIELD_SCHEMAS,
  fieldSchema,
  enrichProperties,
  buildTools,
  loadConfig,
} from "@bitget-ai/bitget-agent-sdk";

describe("fieldSchema", () => {
  it("returns a fresh fragment with type + enum for a closed-enum field", () => {
    const a = fieldSchema("side");
    const b = fieldSchema("side");
    expect(a).toEqual({ type: "string", enum: ["buy", "sell"], description: "Order side." });
    // fresh objects AND fresh enum arrays — never share the curated reference
    expect(a).not.toBe(b);
    expect((a as { enum: string[] }).enum).not.toBe((b as { enum: string[] }).enum);
    expect((a as { enum: string[] }).enum).not.toBe(FIELD_SCHEMAS.side.enum);
  });

  it("returns a type-only fragment (no enum) for an identifier field", () => {
    expect(fieldSchema("symbol")).toEqual({
      type: "string",
      description: "Trading pair, e.g. BTCUSDT.",
    });
    expect("enum" in (fieldSchema("symbol") as object)).toBe(false);
  });

  it("returns a closed enum for the doc-grounded order fields", () => {
    expect(fieldSchema("timeInForce")).toEqual({
      type: "string",
      enum: ["gtc", "post_only", "fok", "ioc"],
      description: "Time in force: gtc, post_only, fok, or ioc.",
    });
    expect(fieldSchema("holdMode")).toEqual({
      type: "string",
      enum: ["one_way_mode", "hedge_mode"],
      description: "Position mode: one_way_mode or hedge_mode.",
    });
    // grounded lowercase yes/no — NOT boolean and NOT YES/NO
    expect((fieldSchema("reduceOnly") as { enum: string[] }).enum).toEqual(["yes", "no"]);
    // strategy trigger fields (values the live exchange accepted in E2E)
    expect((fieldSchema("tpslMode") as { enum: string[] }).enum).toEqual(["full", "partial"]);
    expect((fieldSchema("tpTriggerBy") as { enum: string[] }).enum).toEqual(["mark", "market"]);
  });

  it("returns undefined for uncurated or deliberately-excluded fields", () => {
    expect(fieldSchema("granularity")).toBeUndefined(); // large/version-dependent set
    expect(fieldSchema("type")).toBeUndefined(); // collides across 8 ops — never a global enum
    expect(fieldSchema("status")).toBeUndefined(); // collides across 5 ops
    expect(fieldSchema("nonsense")).toBeUndefined();
  });

  it("curates exactly the closed-enum fields", () => {
    const withEnum = Object.entries(FIELD_SCHEMAS)
      .filter(([, f]) => f.enum !== undefined)
      .map(([k]) => k)
      .sort();
    expect(withEnum).toEqual([
      "category",
      "holdMode",
      "orderType",
      "posSide",
      "reduceOnly",
      "side",
      "slOrderType",
      "slTriggerBy",
      "timeInForce",
      "tpOrderType",
      "tpTriggerBy",
      "tpslMode",
    ]);
  });
});

describe("enrichProperties", () => {
  it("layers enum UNDER a hand-authored property, preserving its description", () => {
    const out = enrichProperties({
      side: { type: "string", description: "buy or sell." },
    });
    expect(out.side).toEqual({
      type: "string",
      enum: ["buy", "sell"],
      description: "buy or sell.", // bespoke description wins over the curated one
    });
  });

  it("passes uncurated and non-object properties through untouched", () => {
    const orders = { type: "array", description: "batch." };
    const out = enrichProperties({
      orders,
      action: { type: "string", enum: ["place"], description: "x" },
    });
    expect(out.orders).toBe(orders); // same reference — untouched
    expect(out.action).toEqual({ type: "string", enum: ["place"], description: "x" });
  });

  it("does not mutate the input map", () => {
    const input = { category: { type: "string", description: "cat." } };
    const snapshot = JSON.parse(JSON.stringify(input));
    enrichProperties(input);
    expect(input).toEqual(snapshot);
  });
});

describe("schema enrichment wired through buildTools", () => {
  const tools = buildTools(loadConfig({ modules: "all", surface: "full" }));
  const byName = (name: string) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`tool ${name} not found`);
    return t;
  };
  const props = (name: string) =>
    byName(name).inputSchema.properties as Record<string, { enum?: string[] }>;

  it("generated tier: getTickers.category carries the category enum + stays required", () => {
    const tickers = byName("getTickers");
    const p = tickers.inputSchema.properties as Record<string, { enum?: string[] }>;
    // Per-op truth from the catalog: getTickers has no MARGIN market, so its
    // enum is the 4-value subset — narrower than the global field dictionary.
    expect(p.category.enum).toEqual(["SPOT", "USDT-FUTURES", "COIN-FUTURES", "USDC-FUTURES"]);
    expect(tickers.inputSchema.required).toContain("category");
  });

  it("generated tier: placeOrder body fields gain side/orderType enums", () => {
    const p = props("placeOrder");
    expect(p.side.enum).toEqual(["buy", "sell"]);
    expect(p.orderType.enum).toEqual(["limit", "market"]);
  });

  it("generated tier: placeOrder also gains timeInForce + reduceOnly enums", () => {
    const p = props("placeOrder");
    // Doc-grounded order from the catalog (single source of truth).
    expect(p.timeInForce.enum).toEqual(["ioc", "fok", "gtc", "post_only"]);
    expect(p.reduceOnly.enum).toEqual(["yes", "no"]);
  });

  it("intent tier (action-tool): market.category gains the enum, keeps its bespoke description", () => {
    const p = byName("market").inputSchema.properties as Record<
      string,
      { enum?: string[]; description?: string }
    >;
    // Union across the market verb's fronted ops: getTickers' 4-value set first,
    // MARGIN appended from an op that supports it (permissive superset).
    expect(p.category.enum).toEqual(["SPOT", "USDT-FUTURES", "COIN-FUTURES", "USDC-FUTURES", "MARGIN"]);
    expect(p.category.description).toMatch(/SPOT or USDT-FUTURES/);
  });

  it("intent tier (hand-written): order.side/orderType gain enums, order.action is untouched", () => {
    const p = props("order");
    expect(p.side.enum).toEqual(["buy", "sell"]);
    expect(p.orderType.enum).toEqual(["limit", "market"]);
    // the action enum is the verb's own routing list, never the field dictionary
    expect(p.action.enum).toContain("place");
    expect(p.action.enum).not.toContain("buy");
  });

  it("intent tier (hand-written): position.posSide gains the long/short enum", () => {
    expect(props("position").posSide.enum).toEqual(["long", "short"]);
  });
});
