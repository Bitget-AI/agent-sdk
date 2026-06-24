export const SERVER_NAME = "bitget-agent-sdk";
export const SERVER_VERSION = "3.0.0";

/** API surface this SDK targets. */
export const API_VARIANT = "UTA (Unified Trading Account) v3";

/**
 * Module ids correspond 1:1 to the OpenAPI tags in `openapi.yaml`.
 * The mapping from a human tag to its module id lives in `TAG_TO_MODULE`
 * and is consumed by the catalog generator, so this list and the catalog
 * never drift apart.
 */
export const MODULES = [
  "account",
  "trade",
  "market",
  "strategy",
  "broker",
  "cryptoloans",
  "instloan",
  "tax",
] as const;

export type ModuleId = (typeof MODULES)[number];

/** Maps an OpenAPI tag (as written in openapi.yaml) to its module id. */
export const TAG_TO_MODULE: Record<string, ModuleId> = {
  Account: "account",
  Trade: "trade",
  Market: "market",
  Strategy: "strategy",
  Broker: "broker",
  "Crypto Loans": "cryptoloans",
  "Inst Loan": "instloan",
  Tax: "tax",
};

/** Default modules exposed when the caller does not narrow the surface. */
export const DEFAULT_MODULES: ModuleId[] = ["account", "trade", "market"];

/**
 * To-B (enterprise) modules hidden from the general surface. They are NOT
 * included by `modules: "all"` and are not discoverable by default; a hidden
 * module appears only when named explicitly (e.g. `modules: "broker"`). This
 * keeps the default agent surface to-C focused while leaving the to-B tools a
 * deliberate opt-in. `raw` still reaches their operations by id.
 */
export const HIDDEN_MODULES: ModuleId[] = ["broker", "instloan"];
