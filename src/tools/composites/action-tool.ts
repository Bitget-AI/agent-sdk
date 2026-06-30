import { randomUUID } from "node:crypto";
import { assertEnum } from "../helpers.js";
import { mergeProjected, projectUnion } from "../param-schema.js";
import { executeWithSafety } from "../safety.js";
import type { JsonSchema, ToolResult, ToolSpec } from "../types.js";
import {
  COMPOSITE_CONTROL_KEYS,
  VIEW_SCHEMA_PROPS,
  callRead,
  composeActionDoc,
  forwardArgs,
  readArgs,
  readMaybeAll,
  readViewOptions,
  requireOperation,
} from "./shared.js";

/**
 * Declarative builder for action-routed intent tools (design §C / P4).
 *
 * Most intent verbs are a thin `action` switch over a handful of catalog
 * operations: reads pass through the normalization view, paged reads gain an
 * opt-in `fetchAll`, and writes flow through the shared dry-run/confirm/readOnly
 * safety gate. Rather than hand-roll a near-identical handler per domain, those
 * tools are described as data here. Bespoke verbs that need real routing logic
 * (`order`'s single↔batch fan-out, `transfer_funds`'s preflight + conditional
 * clientOid) stay hand-written; this builder is for the straightforward case.
 */

export type ActionKind = "read" | "readPaged" | "write";

export interface ActionDef {
  /** Catalog operationId this action routes to. */
  operationId: string;
  /**
   * read = one normalized read; readPaged = read that also honors `fetchAll`
   * (bounded cursor walk); write = routed through the safety gate.
   */
  kind: ActionKind;
  /** One-line, agent-facing description (composed into the `action` enum doc). */
  description: string;
  /** Inject an auto `clientOid` for this write when the caller omits one (P7). */
  autoClientOid?: boolean;
}

export interface ActionToolConfig {
  name: string;
  domain: string;
  /** Surface metadata only; defaults to "private" (most intent tools sign). */
  auth?: "public" | "private";
  /** The tool-level `[VERB] …` one-liner shown in discovery. */
  description: string;
  /** action name → definition. Insertion order drives the enum + docs order. */
  actions: Record<string, ActionDef>;
  /** Extra input-schema properties beyond action / view / dryRun / confirm. */
  properties?: Record<string, unknown>;
}

export function buildActionTool(config: ActionToolConfig): ToolSpec {
  const actionNames = Object.keys(config.actions);
  const defOf = (name: string): ActionDef => {
    const def = config.actions[name];
    if (!def) {
      // Unreachable: `name` always comes from `actionNames` / a validated enum.
      throw new Error(`action "${name}" missing from "${config.name}"`);
    }
    return def;
  };

  const fronts = [...new Set(actionNames.map((name) => defOf(name).operationId))];
  const hasWrite = actionNames.some((name) => defOf(name).kind === "write");
  const hasPaged = actionNames.some((name) => defOf(name).kind === "readPaged");

  // action → operationId, so discover({ tool, action }) can project the exact
  // per-action contract (required/optional, each with type/enum/description).
  const actions: Record<string, string> = {};
  for (const name of actionNames) actions[name] = defOf(name).operationId;

  // Per-action "(needs: …)" hints, generated from the catalog so the flat
  // schema stays honest about each action's required params (shared helper,
  // also used by the hand-written verbs for one consistent reading).
  const actionDoc = composeActionDoc(
    actionNames.map((name) => ({
      name,
      operationId: defOf(name).operationId,
      description: defOf(name).description,
    })),
  );

  // Project every routed operation's params into the flat property union, then
  // let the hand-authored intent props win where they overlap. This auto-fills
  // fields a verb never declared (e.g. strategy_order's TP/SL set) and supplies
  // doc-grounded enums, all from the single source of truth.
  const businessProps = mergeProjected(
    projectUnion(fronts),
    config.properties ?? {},
  );
  for (const key of COMPOSITE_CONTROL_KEYS) delete businessProps[key];
  delete businessProps.dryRun;
  delete businessProps.confirm;

  const properties: Record<string, unknown> = {
    action: {
      type: "string",
      enum: actionNames,
      description: `What to do — ${actionDoc}.`,
    },
    ...businessProps,
    ...VIEW_SCHEMA_PROPS,
  };
  if (hasPaged) {
    properties.fetchAll = {
      type: "boolean",
      description:
        "Paged reads only: walk the cursor to bounded completion (returns { items, pages, truncated }).",
    };
  }
  if (hasWrite) {
    properties.dryRun = {
      type: "boolean",
      description: "Preview a write without sending it.",
    };
    properties.confirm = {
      type: "boolean",
      description:
        "Required to execute destructive (high-risk) writes; without it such a call returns { confirmationRequired: true }.",
    };
  }

  const inputSchema: JsonSchema = {
    type: "object",
    properties,
    required: ["action"],
    additionalProperties: true,
  };

  return {
    name: config.name,
    module: "core",
    domain: config.domain,
    fronts,
    actions,
    method: hasWrite ? "POST" : "GET",
    path: "(composite)",
    auth: config.auth ?? "private",
    // isWrite:false keeps reads available under readOnly; writes self-block at
    // the per-operation safety gate, which also grades destructive ops as high.
    isWrite: false,
    riskLevel: hasWrite ? "write" : "read",
    description: config.description,
    inputSchema,
    handler: async (args, context): Promise<ToolResult> => {
      const action = assertEnum(args, "action", actionNames, {
        required: true,
      })!;
      const def = defOf(action);
      const viewOptions = readViewOptions(args);

      if (def.kind === "write") {
        const writeArgs = forwardArgs(args);
        if (def.autoClientOid && !writeArgs.clientOid) {
          writeArgs.clientOid = randomUUID();
        }
        return executeWithSafety(
          requireOperation(def.operationId),
          writeArgs,
          context,
        );
      }
      if (def.kind === "readPaged") {
        return readMaybeAll(context, def.operationId, args, viewOptions);
      }
      return callRead(context, def.operationId, readArgs(args), viewOptions);
    },
  };
}
