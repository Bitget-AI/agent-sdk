import type { BitgetConfig } from "../config.js";
import type { BitgetRestClient } from "../client/rest-client.js";
import type { ModuleId } from "../constants.js";

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Declarative risk grade for a tool (design §H). Upgrades the binary `isWrite`
 * into read < write < high; `high` tools require an explicit `confirm`.
 */
export type RiskLevel = "read" | "write" | "high";

export interface ToolContext {
  config: BitgetConfig;
  client: BitgetRestClient;
}

export interface ToolResult {
  endpoint: string;
  requestTime: string;
  data: unknown;
}

export interface ToolSpec {
  /** Tool name == OpenAPI operationId (or "raw" for the escape hatch). */
  name: string;
  /** Catalog module, or "core" for cross-cutting tools like `raw`. */
  module: ModuleId | "core";
  /**
   * Semantic, agent-facing grouping for discovery (see `domains.ts`). Distinct
   * from `module`: an intent tool's domain reflects how an agent thinks
   * ("funds"), not which catalog tag backs it. Generated tools default their
   * domain from the module; `raw`/`discover` are "core".
   */
  domain: string;
  /**
   * Catalog operationIds this tool can reach. For a 1:1 generated tool this is
   * `[operationId]`; for an intent tool it is every operation it routes to.
   * The union across the intent surface must cover the catalog (zero capability
   * loss), and every entry must resolve via `getOperation` — both are tested.
   * Empty means "any operation" (the `raw` escape hatch).
   */
  fronts: string[];
  /**
   * For action-routed intent verbs: maps each `action` enum value to the
   * catalog operationId it primarily routes to. This is what lets
   * `discover({ tool, action })` project that action's exact contract — and the
   * same `action` key executes it. Absent for 1:1 generated tools and the
   * `raw`/`discover` escape hatches.
   */
  actions?: Record<string, string>;
  method: "GET" | "POST";
  path: string;
  auth: "public" | "private";
  /** True when calling the tool mutates account state. */
  isWrite: boolean;
  /** Risk grade: read < write < high (high requires `confirm`). */
  riskLevel: RiskLevel;
  description: string;
  inputSchema: JsonSchema;
  handler: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<ToolResult>;
}
