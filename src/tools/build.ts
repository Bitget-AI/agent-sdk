import { CATALOG, type CatalogOperation } from "../generated/catalog.js";
import type { BitgetConfig } from "../config.js";
import { buildRawTool } from "./raw.js";
import { buildDiscoverTool } from "./discover.js";
import { buildCompositeTools } from "./composites/index.js";
import { MODULE_TO_DOMAIN } from "./domains.js";
import { projectParam } from "./param-schema.js";
import { riskLevelOf } from "./risk.js";
import { executeWithSafety } from "./safety.js";
import type { JsonSchema, RiskLevel, ToolSpec } from "./types.js";

function buildInputSchema(
  op: CatalogOperation,
  riskLevel: RiskLevel,
): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const name of op.pathParams) {
    properties[name] = projectParam(name, undefined, "path");
    required.push(name);
  }

  for (const param of op.queryParams) {
    properties[param.name] = projectParam(param.name, param, "query");
    if (param.required) {
      required.push(param.name);
    }
  }

  for (const param of op.bodyParams) {
    properties[param.name] = projectParam(param.name, param, "body");
    if (param.required && !required.includes(param.name)) {
      required.push(param.name);
    }
  }

  // Advertise the safety control params so agents can discover them (P3/P6).
  if (riskLevel !== "read") {
    properties.dryRun = {
      type: "boolean",
      description:
        "If true, validate and return the would-send request without calling the network.",
    };
  }
  if (riskLevel === "high") {
    properties.confirm = {
      type: "boolean",
      description:
        "Must be true to execute this destructive/irreversible operation. Without it the call returns { confirmationRequired: true }.",
    };
  }

  const schema: JsonSchema = {
    type: "object",
    properties,
    additionalProperties: true,
  };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

function describe(op: CatalogOperation, riskLevel: RiskLevel): string {
  const tags: string[] = [];
  if (riskLevel === "high") tags.push("[DANGER]");
  else if (riskLevel === "write") tags.push("[WRITE]");
  if (op.auth === "public") tags.push("[PUBLIC]");
  const prefix = tags.length > 0 ? `${tags.join(" ")} ` : "";
  const summary = op.summary || op.operationId;
  const detail = op.description && op.description !== summary ? ` — ${op.description}` : "";
  return `${prefix}${summary}${detail}`;
}

export function toToolSpec(op: CatalogOperation): ToolSpec {
  const riskLevel = riskLevelOf(op);
  return {
    name: op.operationId,
    module: op.module,
    domain: MODULE_TO_DOMAIN[op.module],
    fronts: [op.operationId],
    method: op.method,
    path: op.path,
    auth: op.auth,
    isWrite: op.isWrite,
    riskLevel,
    description: describe(op, riskLevel),
    inputSchema: buildInputSchema(op, riskLevel),
    handler: (args, context) => executeWithSafety(op, args, context),
  };
}

/**
 * Build the agent-callable tool surface.
 *
 * Always present (the curated capability surface):
 *   - Tier 1 intent composites (order/position/account/transfer), module-gated
 *     and self-guarding via the shared dry-run/confirm/readOnly safety layer.
 *   - The `raw` escape hatch (P5) — reaches any catalog operation by id.
 *   - The `discover` introspection tool — progressive, in-core surface discovery.
 *
 * Only when `surface === "full"` (default during the redesign build-out):
 *   - Tier 0 — one tool per catalog operation (filtered by module + readOnly),
 *     exposing the underlying API endpoints individually. `surface === "intent"`
 *     omits this tier; capability is preserved because every operation remains
 *     reachable via `raw` and (as the intent surface is completed) via `fronts`.
 *
 * Composites, raw, and discover are module "core" so they survive module
 * filtering and are distinguishable from the 1:1 generated tier.
 */
export function buildTools(config: BitgetConfig): ToolSpec[] {
  const moduleSet = new Set(config.modules);
  const tools: ToolSpec[] = [];
  if (config.surface === "full") {
    for (const op of CATALOG) {
      if (!moduleSet.has(op.module)) continue;
      if (config.readOnly && op.isWrite) continue;
      tools.push(toToolSpec(op));
    }
  }
  tools.push(...buildCompositeTools(config));
  tools.push(buildRawTool(config));
  tools.push(buildDiscoverTool(() => tools.slice()));
  return tools;
}
