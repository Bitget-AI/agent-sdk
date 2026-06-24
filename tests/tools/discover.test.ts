import { describe, expect, it } from "vitest";
import { buildTools, loadConfig } from "@bitget-ai/bitget-agent-sdk";
import type { ToolContext, ToolSpec } from "@bitget-ai/bitget-agent-sdk";

// discover is pure introspection — it never touches the client, so a bare
// context is enough to drive its handler.
const ctx = {} as ToolContext;

function discover(surface: "intent" | "full" = "full"): ToolSpec {
  const found = buildTools(loadConfig({ modules: "all", surface })).find(
    (t) => t.name === "discover",
  );
  if (!found) throw new Error("discover tool not found");
  return found;
}

function data(result: { data: unknown }): Record<string, unknown> {
  return result.data as Record<string, unknown>;
}

describe("discover: presence & shape", () => {
  it("is a read-only core-module / meta-domain tool present in both surfaces", () => {
    for (const surface of ["full", "intent"] as const) {
      const d = discover(surface);
      expect(d.module).toBe("core");
      expect(d.domain).toBe("meta");
      expect(d.isWrite).toBe(false);
      expect(d.riskLevel).toBe("read");
    }
  });
});

describe("discover({}) — domain overview", () => {
  it("lists business domains in canonical order, meta kept separate", async () => {
    const res = await discover("full").handler({}, ctx);
    const domains = data(res).domains as { domain: string; toolCount: number }[];
    const names = domains.map((d) => d.domain);
    // canonical order: market < trade < account < funds < …
    expect(names.indexOf("market")).toBeLessThan(names.indexOf("trade"));
    // meta is NOT a business domain — it never leaks into the domain map
    expect(names).not.toContain("meta");
    expect(names).not.toContain("core");
    // every domain reports a positive count
    expect(domains.every((d) => d.toolCount > 0)).toBe(true);
    // cross-cutting tools are reported in their own `meta` group
    const meta = data(res).meta as string[];
    expect(meta).toContain("discover");
    expect(meta).toContain("raw");
    expect(typeof data(res).hint).toBe("string");
  });

  it("intent overview is small and free of per-endpoint domains", async () => {
    const res = await discover("intent").handler({}, ctx);
    const domains = data(res).domains as { domain: string; toolCount: number }[];
    const names = new Set(domains.map((d) => d.domain));
    // intent surface spans the business domains, with meta tools held apart
    expect(names.has("trade")).toBe(true);
    expect(names.has("funds")).toBe(true);
    expect(names.has("meta")).toBe(false);
    expect(data(res).meta as string[]).toContain("discover");
  });
});

describe("discover({ domain }) — tool list", () => {
  it("lists a domain's tools with descriptions", async () => {
    const res = await discover("full").handler({ domain: "trade" }, ctx);
    const tools = (data(res).tools as { name: string; description: string }[]) ?? [];
    const names = tools.map((t) => t.name);
    expect(names).toContain("order");
    expect(names).toContain("position");
    expect(tools.every((t) => typeof t.description === "string")).toBe(true);
  });

  it("returns a soft note + available list for an unknown domain", async () => {
    const res = await discover("full").handler({ domain: "nope" }, ctx);
    expect((data(res).tools as unknown[]).length).toBe(0);
    expect(typeof data(res).note).toBe("string");
    expect(Array.isArray(data(res).available)).toBe(true);
  });
});

describe("discover({ tool }) — full schema", () => {
  it("returns one tool's input schema, fronts, and metadata", async () => {
    const res = await discover("full").handler({ tool: "order" }, ctx);
    const d = data(res);
    expect(d.name).toBe("order");
    expect(d.domain).toBe("trade");
    expect((d.inputSchema as { type: string }).type).toBe("object");
    expect((d.fronts as string[]).includes("placeOrder")).toBe(true);
  });

  it("throws a helpful error for an unknown tool", async () => {
    await expect(discover("full").handler({ tool: "nope" }, ctx)).rejects.toThrow(
      /Unknown tool/,
    );
  });

  it("action-routed verb advertises its actions + an L4 drill-down hint (no flat params)", async () => {
    const res = await discover("intent").handler({ tool: "order" }, ctx);
    const d = data(res);
    expect(Array.isArray(d.actions)).toBe(true);
    expect(d.actions as string[]).toContain("place");
    // The flat schema is a union across actions, so L3 must point at L4 — not
    // pretend to be the exact contract.
    expect(typeof d.hint).toBe("string");
    expect(d.hint as string).toMatch(/discover\(\{ tool: "order", action \}\)/);
    expect(d.params).toBeUndefined();
  });

  it("L4 action contract exposes riskLevel + requiresConfirm so an agent can tell an ordinary write from a high-risk one BEFORE calling", async () => {
    // place is an ordinary write: executes live once --dry-run is omitted, NOT gated by --confirm.
    const place = data(await discover("intent").handler({ tool: "order", action: "place" }, ctx));
    expect(place.isWrite).toBe(true);
    expect(place.riskLevel).toBe("write");
    expect(place.requiresConfirm).toBe(false);

    // cancelAll is high-risk: the contract must advertise that --confirm is required,
    // matching the runtime confirmationRequired gate (same riskLevelOf source).
    const cancelAll = data(await discover("intent").handler({ tool: "order", action: "cancelAll" }, ctx));
    expect(cancelAll.riskLevel).toBe("high");
    expect(cancelAll.requiresConfirm).toBe(true);
  });

  it("action-less tool returns an explicit required/optional param split (no L4 to defer to)", async () => {
    const res = await discover("intent").handler({ tool: "account_overview" }, ctx);
    const d = data(res);
    expect(d.actions).toBeUndefined();
    expect(d.hint).toBeUndefined();
    const params = d.params as {
      required: { name: string }[];
      optional: { name: string }[];
    };
    expect(Array.isArray(params.required)).toBe(true);
    expect(Array.isArray(params.optional)).toBe(true);
    const names = [...params.required, ...params.optional].map((p) => p.name);
    expect(names).toContain("category");
    expect(names).toContain("symbol");
    // every field carries its full schema body (description/type/enum…), not a
    // bare name — that is the whole point of the split.
    expect(
      [...params.required, ...params.optional].every(
        (p) => Object.keys(p as Record<string, unknown>).length > 1,
      ),
    ).toBe(true);
  });
});

describe("discover({ tool, action }) — conditional & action-specific contract (F1/F2)", () => {
  it("order.place advertises price as conditionally required when orderType is limit (F2)", async () => {
    const d = data(await discover("intent").handler({ tool: "order", action: "place" }, ctx));
    // top-level summary of the obligations so an agent reads them at a glance
    const cond = d.conditionalRequired as {
      param: string;
      requiredWhen: string;
      trigger?: { param: string; equals: string };
    }[];
    expect(Array.isArray(cond)).toBe(true);
    const price = cond.find((c) => c.param === "price");
    expect(price).toBeDefined();
    expect(price?.trigger).toEqual({ param: "orderType", equals: "limit" });
    // the obligation also travels on the param fragment itself, which stays
    // OPTIONAL at the flat level (required only under the condition).
    const optional = d.optional as Record<string, unknown>[];
    const priceField = optional.find((p) => p.name === "price");
    expect(priceField?.requiredWhen as string).toMatch(/limit/i);
    expect(priceField?.requiredWhenTrigger).toEqual({ param: "orderType", equals: "limit" });
    const required = d.required as Record<string, unknown>[];
    expect(required.some((p) => p.name === "price")).toBe(false);
  });

  it("position exposes a single-position `close` action distinct from closeAll (F1)", async () => {
    const verb = data(await discover("intent").handler({ tool: "position" }, ctx));
    expect(verb.actions as string[]).toContain("close");
    expect(verb.actions as string[]).toContain("closeAll");
  });

  it("position.close hard-requires symbol AND is gated high-risk — an agent can't accidentally flatten everything (F1)", async () => {
    const d = data(await discover("intent").handler({ tool: "position", action: "close" }, ctx));
    // same destructive op as closeAll → must advertise the --confirm gate
    expect(d.operationId).toBe("closeAllPositions");
    expect(d.riskLevel).toBe("high");
    expect(d.requiresConfirm).toBe(true);
    // symbol is OPTIONAL on the raw op but REQUIRED for the single-position intent
    const required = d.required as Record<string, unknown>[];
    expect(required.some((p) => p.name === "symbol")).toBe(true);
    const optional = d.optional as Record<string, unknown>[];
    expect(optional.some((p) => p.name === "symbol")).toBe(false);
    // posSide carries the hedge-mode requiredWhen annotation
    const posSide = optional.find((p) => p.name === "posSide");
    expect(posSide?.requiredWhen as string).toMatch(/hedge|two-way/i);
  });

  it("closeAll (the SAME op) does NOT inherit close's symbol requirement — rules are per-action, not per-op (F1)", async () => {
    const d = data(await discover("intent").handler({ tool: "position", action: "closeAll" }, ctx));
    expect(d.operationId).toBe("closeAllPositions");
    const required = d.required as Record<string, unknown>[];
    expect(required.some((p) => p.name === "symbol")).toBe(false);
    expect(d.conditionalRequired).toBeUndefined();
  });
});

describe("discover({ search }) — keyword search", () => {
  it("ranks an exact name hit first and explains why each tool matched", async () => {
    const res = await discover("intent").handler({ search: "transfer" }, ctx);
    const d = data(res);
    const matches = d.matches as {
      name: string;
      matchedActions?: string[];
      matchedFronts?: string[];
    }[];
    expect(matches.length).toBeGreaterThan(0);
    // transfer_funds is the only name hit on the intent surface → ranks first.
    expect(matches[0].name).toBe("transfer_funds");
    // it surfaced partly because its catalog fronts carry the keyword
    expect(matches[0].matchedFronts).toBeDefined();
    expect(typeof d.hint).toBe("string");
  });

  it("surfaces a verb through a matched action, not just its name", async () => {
    const res = await discover("intent").handler({ search: "borrow" }, ctx);
    const matches = (data(res).matches as { matchedActions?: string[] }[]) ?? [];
    expect(
      matches.some((m) => m.matchedActions?.includes("borrow")),
    ).toBe(true);
  });

  it("never returns meta tools (they live under `meta`, not intent search)", async () => {
    const res = await discover("intent").handler({ search: "discover" }, ctx);
    const matches = (data(res).matches as { name: string }[]) ?? [];
    expect(matches.some((m) => m.name === "discover")).toBe(false);
  });

  it("returns a soft note (no matches) for a miss", async () => {
    const res = await discover("intent").handler({ search: "zzzznotathing" }, ctx);
    expect((data(res).matches as unknown[]).length).toBe(0);
    expect(typeof data(res).note).toBe("string");
  });
});
