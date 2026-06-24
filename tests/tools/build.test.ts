import { describe, expect, it } from "vitest";
import {
  buildTools,
  loadConfig,
  CATALOG,
  MODULES,
  CATALOG_OPERATION_COUNT,
} from "@bitget-ai/bitget-agent-sdk";

describe("buildTools", () => {
  it("exposes one tool per catalog operation (plus core tools) when all modules enabled", () => {
    // Name every module explicitly (incl. the hidden to-B ones broker/instloan)
    // — `modules: "all"` deliberately omits hidden modules, so full-catalog
    // coverage requires opting them in by name.
    const tools = buildTools(loadConfig({ modules: MODULES.join(","), surface: "full" }));
    const generated = tools.filter((t) => t.module !== "core");
    expect(generated).toHaveLength(CATALOG_OPERATION_COUNT);
    expect(generated).toHaveLength(CATALOG.length);
    const names = new Set(tools.map((t) => t.name));
    expect(names.size).toBe(tools.length);
    expect(names.has("raw")).toBe(true);
  });

  it("filters generated tools by module but always includes raw", () => {
    const tools = buildTools(loadConfig({ modules: "market", surface: "full" }));
    const generated = tools.filter((t) => t.module !== "core");
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every((t) => t.module === "market")).toBe(true);
    expect(tools.some((t) => t.name === "raw")).toBe(true);
  });

  it("drops write tools in readOnly mode", () => {
    const all = buildTools(loadConfig({ modules: "all", surface: "full" }));
    const ro = buildTools(loadConfig({ modules: "all", surface: "full", readOnly: true }));
    expect(ro.length).toBeLessThan(all.length);
    expect(ro.every((t) => t.isWrite === false)).toBe(true);
  });

  it("every catalog module is a known ModuleId", () => {
    const known = new Set<string>(MODULES);
    for (const op of CATALOG) {
      expect(known.has(op.module)).toBe(true);
    }
  });

  it("builds a valid JSON schema with required path/query params", () => {
    const tools = buildTools(loadConfig({ modules: "all", surface: "full" }));
    const tickers = tools.find((t) => t.name === "getTickers");
    expect(tickers).toBeDefined();
    expect(tickers!.inputSchema.type).toBe("object");
    expect(tickers!.inputSchema.required).toContain("category");
    expect(tickers!.method).toBe("GET");
    expect(tickers!.auth).toBe("public");
  });

  it("mirrors the catalog's doc-grounded body types (scalar string vs array)", () => {
    const tools = buildTools(loadConfig({ modules: "all", surface: "full" }));
    const props = (name: string) =>
      tools.find((t) => t.name === name)!.inputSchema.properties as Record<
        string,
        { type?: string; enum?: string[] }
      >;
    // Scalar body fields with no enum must still be typed (regression: the old
    // projection only typed body fields that carried an enum, leaving qty/price
    // untyped). A spec change that drops the catalog `type` breaks this.
    const order = props("placeOrder");
    expect(order.qty.type).toBe("string");
    expect(order.price.type).toBe("string");
    expect(order.takeProfit.type).toBe("string");
    // Enum body field keeps string + enum.
    expect(order.category.type).toBe("string");
    expect(order.category.enum).toContain("USDT-FUTURES");
    // Genuine array body fields stay `array`, never coerced to string.
    const repay = props("repay");
    expect(repay.repayableCoinList.type).toBe("array");
    expect(repay.paymentCoinList.type).toBe("array");
  });
});
