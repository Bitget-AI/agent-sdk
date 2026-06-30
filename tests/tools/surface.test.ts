import { describe, expect, it } from "vitest";
import { buildTools, loadConfig } from "@bitget-ai/bitget-agent-sdk";

const CORE_TOOLS = ["order", "position", "account_overview", "transfer_funds", "raw", "discover"];

describe("surface: intent (default)", () => {
  it("defaults to the intent surface", () => {
    expect(loadConfig().surface).toBe("intent");
    expect(loadConfig({ modules: "all" }).surface).toBe("intent");
  });

  it("emits the 1:1 generated tier alongside the curated tools when surface=full", () => {
    const names = new Set(
      buildTools(loadConfig({ modules: "all", surface: "full" })).map((t) => t.name),
    );
    // a sample of the generated 1:1 tools is present
    expect(names.has("placeOrder")).toBe(true);
    expect(names.has("getTickers")).toBe(true);
    // and so are the curated core tools
    for (const name of CORE_TOOLS) expect(names.has(name)).toBe(true);
  });
});

describe("surface: intent", () => {
  it("omits the 1:1 generated tier but keeps the curated surface", () => {
    const names = new Set(
      buildTools(loadConfig({ modules: "all", surface: "intent" })).map((t) => t.name),
    );
    // underlying-API tools are gone
    expect(names.has("placeOrder")).toBe(false);
    expect(names.has("getTickers")).toBe(false);
    // intent verbs + escape hatch + discovery remain
    for (const name of CORE_TOOLS) expect(names.has(name)).toBe(true);
  });

  it("contains only core-module tools (no generated tier leaks through)", () => {
    const tools = buildTools(loadConfig({ modules: "all", surface: "intent" }));
    expect(tools.every((t) => t.module === "core")).toBe(true);
    expect(tools.length).toBeLessThan(
      buildTools(loadConfig({ modules: "all", surface: "full" })).length,
    );
  });

  it("rejects an unknown surface", () => {
    expect(() => loadConfig({ surface: "wide" })).toThrow(/Unknown surface/);
  });

  it("keeps tool names unique in both surfaces", () => {
    for (const surface of ["full", "intent"] as const) {
      const names = buildTools(loadConfig({ modules: "all", surface })).map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
