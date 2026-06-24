import { describe, expect, it } from "vitest";
// The Phase-0 doc parser is a build script (.mjs). These tests exercise its
// PURE functions on inline doc strings — no filesystem, no openapi.yaml — so a
// parsing regression fails here long before it can corrupt a write-back.
import {
  splitRow,
  extractEnums,
  cleanDescription,
  parseRequired,
  parseParamTable,
  parseHttpRequest,
  parseDoc,
} from "../../scripts/extract-doc-metadata.mjs";

describe("extractEnums (conservative backtick heuristic)", () => {
  it("extracts leading-token values with trailing descriptions", () => {
    expect(extractEnums("Product type <br/> `SPOT` Spot trading <br/> `MARGIN` Margin trading")).toEqual([
      "SPOT",
      "MARGIN",
    ]);
  });

  it("extracts slash-joined value groups as separate values", () => {
    expect(extractEnums("Order side<br/>`buy`/`sell`")).toEqual(["buy", "sell"]);
    expect(extractEnums("Reduce-only<br/>`yes`/`no`, default `no`;")).toEqual(["yes", "no"]);
  });

  it("rejects example values (e.g.,) — symbol stays enum-free", () => {
    expect(extractEnums("Symbol name <br/>e.g.,`BTCUSDT`")).toEqual([]);
  });

  it("rejects cross-references and unit prose (the qty trap)", () => {
    // `tpslMode=partial` (cross-ref, has '='), `base coin` (unit, has space)
    expect(extractEnums("Required when `tpslMode=partial`, unit is `base coin`")).toEqual([]);
  });

  it("rejects lone grouping sub-labels with internal slashes (the qty market headers)", () => {
    // "`Spot/Margin`" and "`USDT/USDC-Futures`" are section labels, not values
    const qty =
      "Order quantity <br/>`Spot/Margin`<br/> For market buy orders the unit is quote coin<br/> `USDT/USDC-Futures` <br/> unit is base coin <br/> `COIN-Futures` <br/> unit is quote coin";
    expect(extractEnums(qty)).toEqual([]);
  });

  it("dedupes repeated values (e.g. a trailing Default:`x`)", () => {
    expect(extractEnums("Strategy Type<br/>`tpsl` TP/SL<br/>Default:`tpsl`")).toEqual(["tpsl"]);
  });

  it("handles the full timeInForce cell", () => {
    const tif =
      "Time in force<br/>`ioc` cancel<br/>`fok` kill<br/>`gtc` good til<br/>`post_only` maker<br/>required when orderType is `limit`. defaults to `gtc`";
    expect(extractEnums(tif)).toEqual(["ioc", "fok", "gtc", "post_only"]);
  });
});

describe("cleanDescription", () => {
  it("flattens <br/>, strips bold/backticks/u-tags, collapses whitespace", () => {
    expect(cleanDescription("Position side<br/>`long`/`short`<br/> **futures** only")).toBe(
      "Position side long/short futures only",
    );
  });
});

describe("parseRequired", () => {
  it("maps Yes/是/true → true, everything else → false", () => {
    expect(parseRequired("Yes")).toBe(true);
    expect(parseRequired("是")).toBe(true);
    expect(parseRequired("No")).toBe(false);
    expect(parseRequired("")).toBe(false);
    expect(parseRequired("conditional")).toBe(false);
  });
});

describe("splitRow", () => {
  it("drops outer pipes and trims cells", () => {
    expect(splitRow("| a | b  |  c |")).toEqual(["a", "b", "c"]);
  });
});

describe("parseParamTable", () => {
  const table = `
| Parameter         | Type   | Required | Comments                          |
|:------------------|:-------|:---------|:----------------------------------|
| category          | String | Yes      | \`SPOT\` spot <br/> \`MARGIN\` margin |
| symbol            | String | Yes      | Symbol name <br/>e.g.,\`BTCUSDT\`    |
| repayableCoinList | Array  | Yes      | Repayable coin list               |
| &gt; index [0]    | String | Yes      | Repayable coin name<br/>e.g.,\`USDT\` |
`;

  it("parses rows, skips header/separator, and skips nested &gt; element rows", () => {
    const rows = parseParamTable(table);
    expect(rows.map((r) => r.name)).toEqual(["category", "symbol", "repayableCoinList"]);
    expect(rows[0]).toMatchObject({
      name: "category",
      type: "String",
      required: true,
      enum: ["SPOT", "MARGIN"],
    });
    expect(rows[1].enum).toEqual([]); // symbol example is not an enum
    expect(rows[2]).toMatchObject({ name: "repayableCoinList", type: "Array", required: true });
  });
});

describe("parseHttpRequest", () => {
  it("captures method, path, rate limit and permission", () => {
    const doc = `### HTTP Request

- POST /api/v3/trade/place-order
- Rate limit: 10/sec/UID
- Permission: UTA trade (read & write)
`;
    expect(parseHttpRequest(doc)).toEqual({
      method: "POST",
      path: "/api/v3/trade/place-order",
      rateLimit: "Rate limit: 10/sec/UID",
      permission: "Permission: UTA trade (read & write)",
    });
  });

  it("tolerates the 'Speed limit' phrasing and returns null without an endpoint", () => {
    expect(parseHttpRequest("### HTTP Request\n\n- POST /api/v3/x\n- Speed limit is 10/s (UID)\n").rateLimit).toBe(
      "Speed limit is 10/s (UID)",
    );
    expect(parseHttpRequest("# Title\n\nno request block here")).toBeNull();
  });
});

describe("parseDoc (end-to-end)", () => {
  const doc = `---
sidebar_position: 5
---

# Place Order

### Description
Places an order.

### HTTP Request

- POST /api/v3/trade/place-order
- Rate limit: 10/sec/UID

### Request Parameters

| Parameter | Type   | Required | Comments              |
|:----------|:-------|:---------|:----------------------|
| side      | String | Yes      | \`buy\`/\`sell\`          |
| orderType | String | Yes      | \`limit\`/\`market\`      |

###  Response Parameters

| Parameter | Type   | Comments |
|:----------|:-------|:---------|
| orderId   | String | Order ID |
`;

  it("assembles title, join-key, params and response params", () => {
    const parsed = parseDoc(doc, "trade/Place-Order.md");
    expect(parsed).toMatchObject({
      title: "Place Order",
      method: "POST",
      path: "/api/v3/trade/place-order",
      key: "POST /api/v3/trade/place-order",
    });
    expect(parsed!.params.map((p) => p.name)).toEqual(["side", "orderType"]);
    expect(parsed!.params[0].enum).toEqual(["buy", "sell"]);
    expect(parsed!.responseParams.map((p) => p.name)).toEqual(["orderId"]);
  });

  it("returns null for a doc with no REST endpoint (e.g. enum.md/guide.md)", () => {
    expect(parseDoc("# Enums\n\n## category\n- `SPOT` spot\n")).toBeNull();
  });
});
