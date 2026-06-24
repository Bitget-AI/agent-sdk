import { describe, expect, it } from "vitest";
import {
  asRecord,
  compactObject,
  requireString,
  readString,
  readNumber,
  readBoolean,
  readStringArray,
  readObjectArray,
  ensureOneOf,
  assertEnum,
} from "@bitget-ai/bitget-agent-sdk";

describe("coercion & validation helpers", () => {
  it("readString coerces numbers/booleans and treats empty as absent", () => {
    expect(readString({ a: "x" }, "a")).toBe("x");
    expect(readString({ a: 42 }, "a")).toBe("42");
    expect(readString({ a: true }, "a")).toBe("true");
    expect(readString({ a: "" }, "a")).toBeUndefined();
    expect(readString({}, "a")).toBeUndefined();
  });

  it("requireString throws a fixable error when absent", () => {
    expect(() => requireString({}, "symbol")).toThrow(/Missing required parameter "symbol"/);
    expect(requireString({ symbol: "BTCUSDT" }, "symbol")).toBe("BTCUSDT");
  });

  it("readNumber parses numeric strings and rejects junk", () => {
    expect(readNumber({ p: "1.5" }, "p")).toBe(1.5);
    expect(readNumber({ p: 3 }, "p")).toBe(3);
    expect(readNumber({}, "p")).toBeUndefined();
    expect(() => readNumber({ p: "abc" }, "p")).toThrow(/numeric value/);
  });

  it("readBoolean accepts true/false/1/0/yes/no strings", () => {
    expect(readBoolean({ b: "true" }, "b")).toBe(true);
    expect(readBoolean({ b: "FALSE" }, "b")).toBe(false);
    expect(readBoolean({ b: 1 }, "b")).toBe(true);
    expect(readBoolean({ b: 0 }, "b")).toBe(false);
    expect(readBoolean({}, "b")).toBeUndefined();
    expect(() => readBoolean({ b: "maybe" }, "b")).toThrow(/must be a boolean/);
  });

  it("readStringArray parses JSON-string arrays, CSV, and singletons", () => {
    expect(readStringArray({ s: '["BTCUSDT","ETHUSDT"]' }, "s")).toEqual([
      "BTCUSDT",
      "ETHUSDT",
    ]);
    expect(readStringArray({ s: ["A", "B"] }, "s")).toEqual(["A", "B"]);
    expect(readStringArray({ s: "A,B , C" }, "s")).toEqual(["A", "B", "C"]);
    expect(readStringArray({ s: "BTCUSDT" }, "s")).toEqual(["BTCUSDT"]);
    expect(readStringArray({}, "s")).toBeUndefined();
    expect(() => readStringArray({ s: "[oops" }, "s")).toThrow(/JSON array/);
  });

  it("readObjectArray parses a JSON string of objects", () => {
    expect(readObjectArray({ o: '[{"symbol":"BTCUSDT"}]' }, "o")).toEqual([
      { symbol: "BTCUSDT" },
    ]);
    expect(readObjectArray({ o: [{ a: 1 }] }, "o")).toEqual([{ a: 1 }]);
    expect(() => readObjectArray({ o: '["not-an-object"]' }, "o")).toThrow(
      /must be an object/,
    );
  });

  it("ensureOneOf / assertEnum reject unknown enums before the call", () => {
    expect(ensureOneOf("SPOT", ["SPOT", "USDT-FUTURES"] as const, "category")).toBe(
      "SPOT",
    );
    expect(() => ensureOneOf("MARGIN", ["SPOT"] as const, "category")).toThrow(
      /Invalid category "MARGIN"/,
    );
    expect(assertEnum({ side: "buy" }, "side", ["buy", "sell"] as const)).toBe("buy");
    expect(assertEnum({}, "side", ["buy", "sell"] as const)).toBeUndefined();
    expect(() =>
      assertEnum({}, "side", ["buy", "sell"] as const, { required: true }),
    ).toThrow(/Missing required parameter "side"/);
  });

  it("asRecord / compactObject behave as documented", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toEqual({});
    expect(asRecord([1, 2])).toEqual({});
    expect(compactObject({ a: 1, b: undefined, c: null, d: "" })).toEqual({
      a: 1,
      d: "",
    });
  });
});
