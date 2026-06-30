import { describe, expect, it } from "vitest";
import { applyView, projectFields, trimNulls } from "@bitget-ai/bitget-agent-sdk";

describe("trimNulls", () => {
  it("drops null/undefined recursively but keeps other falsy values", () => {
    const input = {
      a: 1,
      b: null,
      c: undefined,
      d: 0,
      e: "",
      f: false,
      nested: { keep: "x", drop: null },
    };
    expect(trimNulls(input)).toEqual({
      a: 1,
      d: 0,
      e: "",
      f: false,
      nested: { keep: "x" },
    });
  });

  it("preserves arrays and trims objects inside them", () => {
    expect(trimNulls([{ a: 1, b: null }, { c: null }])).toEqual([
      { a: 1 },
      {},
    ]);
  });

  it("passes scalars through untouched", () => {
    expect(trimNulls("hi")).toBe("hi");
    expect(trimNulls(42)).toBe(42);
  });
});

describe("projectFields", () => {
  it("keeps only the named fields on an object", () => {
    expect(projectFields({ a: 1, b: 2, c: 3 }, ["a", "c"])).toEqual({
      a: 1,
      c: 3,
    });
  });

  it("projects each object of an array and ignores absent fields", () => {
    expect(
      projectFields([{ a: 1, b: 2 }, { a: 3 }], ["a", "missing"]),
    ).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("is a no-op for an empty field list", () => {
    const value = { a: 1, b: 2 };
    expect(projectFields(value, [])).toBe(value);
  });

  it("passes non-objects through", () => {
    expect(projectFields("x", ["a"])).toBe("x");
    expect(projectFields([1, 2, 3], ["a"])).toEqual([1, 2, 3]);
  });
});

describe("applyView", () => {
  const data = { a: 1, b: null, c: { d: 2, e: null } };

  it("defaults to summary, which trims nulls", () => {
    expect(applyView(data)).toEqual({ a: 1, c: { d: 2 } });
  });

  it("full returns the payload untouched (nulls retained)", () => {
    expect(applyView(data, { view: "full" })).toEqual(data);
  });

  it("explicit fields trim then project, even under full view", () => {
    expect(
      applyView({ a: 1, b: null, c: 3 }, { view: "full", fields: ["a", "b"] }),
    ).toEqual({ a: 1 });
  });

  it("summaryFields project only in summary view", () => {
    const rows = [
      { symbol: "BTCUSDT", price: "50000", junk: null, extra: "x" },
      { symbol: "ETHUSDT", price: "3000", junk: null, extra: "y" },
    ];
    expect(
      applyView(rows, { summaryFields: ["symbol", "price"] }),
    ).toEqual([
      { symbol: "BTCUSDT", price: "50000" },
      { symbol: "ETHUSDT", price: "3000" },
    ]);
    // full view ignores summaryFields entirely.
    expect(applyView(rows, { view: "full", summaryFields: ["symbol"] })).toEqual(
      rows,
    );
  });
});
