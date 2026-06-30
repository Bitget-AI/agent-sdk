import type { ModuleId } from "../constants.js";

/**
 * Semantic domains — the agent-facing taxonomy used by `discover` to group the
 * tool surface (design guide §1 "一屏能读完" / §5.1 layered discovery).
 *
 * A domain is the *intent* axis and is deliberately distinct from a tool's
 * mechanical `module` (the catalog tag). Intent tools (composites) live in the
 * domain that matches how an agent thinks ("funds", "subaccount"), even when
 * the operations they front are spread across catalog modules.
 *
 * Domains are business intents ONLY. The cross-cutting meta tools (`raw`,
 * `discover`) are NOT business domains — they carry `domain === META_DOMAIN`
 * and `discover` surfaces them in a separate `meta` group, never mixed into the
 * domain map.
 */
export const DOMAINS = [
  "market",
  "trade",
  "account",
  "funds",
  "subaccount",
  "broker",
  "loan",
  "instloan",
  "tax",
] as const;

export type Domain = (typeof DOMAINS)[number];

/**
 * Pseudo-domain for cross-cutting meta tools (`raw`, `discover`). Deliberately
 * outside `DOMAINS` so it sorts last and is reported separately by `discover`.
 */
export const META_DOMAIN = "meta";

/**
 * Default domain for a generated (Tier 0) tool, derived from its catalog module.
 * Intent tools override this with an explicit `domain`; the funds/subaccount
 * domains are carved out of the account module by composites and so have no
 * direct module mapping here.
 */
export const MODULE_TO_DOMAIN: Record<ModuleId, Domain> = {
  account: "account",
  trade: "trade",
  market: "market",
  strategy: "trade",
  broker: "broker",
  cryptoloans: "loan",
  instloan: "instloan",
  tax: "tax",
};

/** Stable sort index for a domain (canonical `DOMAINS` order). */
export function domainOrder(domain: string): number {
  const index = (DOMAINS as readonly string[]).indexOf(domain);
  return index === -1 ? DOMAINS.length : index;
}
