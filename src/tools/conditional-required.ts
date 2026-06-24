/**
 * Per-(verb, action) contract overrides the catalog/OpenAPI cannot express.
 *
 * The catalog records required-ness as one boolean per param per operation, but
 * two real obligations don't fit that shape:
 *
 *   1. ACTION-specific required — one intent action makes an otherwise-optional
 *      catalog param mandatory. `position.close` routes to the SAME
 *      close-positions op as `position.closeAll`, but for the single-position
 *      intent `symbol` MUST be present: omitting it would close the whole
 *      category — the exact accident the named `close` action exists to prevent.
 *
 *   2. CONDITIONAL required — a param is required only when another param holds a
 *      value, or only in a given account mode: `price` is required for limit
 *      orders (market orders omit it); `posSide` is required in hedge/two-way
 *      position mode.
 *
 * `discover({ tool, action })` (rung 4 — the authoritative pre-call contract)
 * surfaces these so an agent sees the real obligation BEFORE assembling a call,
 * instead of discovering it from a rejected request. Keyed by `${tool}.${action}`
 * (NOT operationId) so two actions sharing one operationId — close vs closeAll —
 * can carry different rules.
 */

/** A param that becomes required under a stated condition. */
export interface ConditionalRule {
  /** The param this rule governs. */
  param: string;
  /** Agent-facing phrasing of when the param is required. */
  requiredWhen: string;
  /** Structured trigger when the condition is "another request param equals X". */
  trigger?: { param: string; equals: string };
}

export interface ActionContract {
  /** Params required for THIS action beyond the catalog op's own required set. */
  alsoRequired?: string[];
  /** Params that are conditionally required (annotated, not hard-required). */
  conditional?: ConditionalRule[];
}

const CONTRACTS: Record<string, ActionContract> = {
  "order.place": {
    conditional: [
      {
        param: "price",
        requiredWhen: "orderType is limit (market orders take no price)",
        trigger: { param: "orderType", equals: "limit" },
      },
      {
        param: "posSide",
        requiredWhen: "the futures account is in hedge (two-way) position mode",
      },
    ],
  },
  "position.close": {
    // close-positions marks symbol optional (no symbol → closes the whole
    // category). The single-position `close` intent makes it mandatory so that
    // can't happen by omission.
    alsoRequired: ["symbol"],
    conditional: [
      {
        param: "posSide",
        requiredWhen: "the account is in hedge (two-way) mode (closes only that side)",
      },
    ],
  },
};

/** Contract override for a (tool, action) pair, if any. */
export function actionContract(
  tool: string,
  action: string,
): ActionContract | undefined {
  return CONTRACTS[`${tool}.${action}`];
}
