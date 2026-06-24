/**
 * Curated input-schema fragments for well-known Bitget fields (design §A / P1-9).
 *
 * ⚠️ DEMOTED to a thin FALLBACK/OVERRIDE layer. This dictionary was the original
 * *source* of enums back when `openapi.yaml` typed every field as a bare `string`
 * with no enum/description. The self-describing-SDK effort changed that: the spec
 * is now the single source of truth, enriched per-operation from the UTA v3 docs,
 * and `param-schema.ts` projects each op's OWN `type`/`enum`/`description`
 * straight from the catalog. So the authoritative value hints now ride on the
 * per-op catalog metadata, not here.
 *
 * What remains useful here:
 *   - a fallback for any field an op never enriched (projection prefers the
 *     catalog metadata and only falls back to this when the catalog is silent);
 *   - a place to pin a small set of *closed, stable, op-agnostic* enums and
 *     unambiguous identifier descriptions that are correct for EVERY op that
 *     uses the field by that name.
 *
 * Single-source payoff — the old name-collision exclusion is GONE. `type`
 * (strategy {tpsl,trigger} vs the 100+-value financial-record set vs kline candle
 * type) and `status` used to be omitted here because enrichment matched by GLOBAL
 * field name and one enum would corrupt sibling ops; now each op carries its OWN
 * correct enum from the spec, so those fields are handled per-op upstream and need
 * no entry here. Two carve-outs still make sense as deliberate non-entries:
 *   1. Large / version-dependent or genuinely-open sets — transfer
 *      `fromType`/`toType` — left WITHOUT a global enum so a strict
 *      validator never rejects a value the API itself accepts. (The kline
 *      interval is NOT one of these: it is the closed-enum `interval` param,
 *      projected per-op from the catalog — there is no open `granularity`.)
 *   2. Response-only fields (execType/orderStatus/tradeScope/kLineType/…) never
 *      appear in a request schema, so curating them here is inert.
 *
 * Being permissive beats being wrong: a missing enum costs a hint, an incomplete
 * (or misapplied) enum blocks a valid order.
 */

export interface FieldSchema {
  type?: string;
  enum?: readonly string[];
  description: string;
}

/** A projected, caller-owned fragment (fresh enum array, never the curated ref). */
export interface FieldSchemaFragment {
  type?: string;
  enum?: string[];
  description: string;
}

export const FIELD_SCHEMAS: Readonly<Record<string, FieldSchema>> = {
  // ── closed enums (spec-prose- or contract-grounded) ──
  category: {
    type: "string",
    enum: ["SPOT", "MARGIN", "USDT-FUTURES", "COIN-FUTURES", "USDC-FUTURES"],
    description: "Product category.",
  },
  side: { type: "string", enum: ["buy", "sell"], description: "Order side." },
  orderType: { type: "string", enum: ["limit", "market"], description: "Order type." },
  posSide: {
    type: "string",
    enum: ["long", "short"],
    description: "Position side (hedge mode).",
  },
  timeInForce: {
    type: "string",
    enum: ["gtc", "post_only", "fok", "ioc"],
    description: "Time in force: gtc, post_only, fok, or ioc.",
  },
  holdMode: {
    type: "string",
    enum: ["one_way_mode", "hedge_mode"],
    description: "Position mode: one_way_mode or hedge_mode.",
  },
  reduceOnly: {
    type: "string",
    enum: ["yes", "no"],
    description: "Whether the order only reduces a position (yes/no).",
  },
  // ── strategy-order trigger fields (values accepted by the live exchange in E2E) ──
  tpslMode: {
    type: "string",
    enum: ["full", "partial"],
    description: "TP/SL scope: full position or partial.",
  },
  tpTriggerBy: {
    type: "string",
    enum: ["mark", "market"],
    description: "Take-profit trigger price type.",
  },
  slTriggerBy: {
    type: "string",
    enum: ["mark", "market"],
    description: "Stop-loss trigger price type.",
  },
  tpOrderType: {
    type: "string",
    enum: ["limit", "market"],
    description: "Take-profit execution order type.",
  },
  slOrderType: {
    type: "string",
    enum: ["limit", "market"],
    description: "Stop-loss execution order type.",
  },
  // ── unambiguous string identifiers (type hint only, no enum) ──
  symbol: { type: "string", description: "Trading pair, e.g. BTCUSDT." },
  coin: { type: "string", description: "Coin, e.g. USDT." },
  clientOid: {
    type: "string",
    description: "Client-supplied idempotency key (unique per order).",
  },
  cursor: {
    type: "string",
    description: "Pagination cursor returned by the previous page.",
  },
  chain: { type: "string", description: "On-chain network, e.g. ERC20 or TRC20." },
};

/** A fresh JSON-Schema fragment for `name`, or `undefined` when none is curated. */
export function fieldSchema(name: string): FieldSchemaFragment | undefined {
  const f = FIELD_SCHEMAS[name];
  if (!f) {
    return undefined;
  }
  const fragment: FieldSchemaFragment = { description: f.description };
  if (f.type !== undefined) {
    fragment.type = f.type;
  }
  if (f.enum !== undefined) {
    fragment.enum = [...f.enum]; // fresh array — never share the curated ref
  }
  return fragment;
}

/**
 * Layer curated hints into a hand-authored property map. For each property that
 * has a curated entry, the curated `type`/`enum` are merged UNDER the existing
 * fields, so a bespoke (often more specific) description is preserved while the
 * property still gains its enum. Properties with no curated entry pass through
 * untouched. Returns a new object; inputs are never mutated.
 */
export function enrichProperties(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(props)) {
    const curated = fieldSchema(name);
    if (curated && schema && typeof schema === "object" && !Array.isArray(schema)) {
      out[name] = { ...curated, ...(schema as Record<string, unknown>) };
    } else {
      out[name] = schema;
    }
  }
  return out;
}
