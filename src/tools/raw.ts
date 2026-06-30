import { getOperation } from "../generated/catalog.js";
import { ValidationError } from "../utils/errors.js";
import { asRecord, requireString } from "./helpers.js";
import { META_DOMAIN } from "./domains.js";
import { executeWithSafety } from "./safety.js";
import type { BitgetConfig } from "../config.js";
import type { JsonSchema, ToolSpec } from "./types.js";

export const RAW_TOOL_NAME = "raw";

function rawInputSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      operationId: {
        type: "string",
        description:
          "Catalog operationId to invoke (e.g. getTickers, placeOrder). See the generated catalog for valid ids.",
      },
      args: {
        type: "object",
        description:
          "Flat argument record forwarded verbatim to callOperation (path params, query, and/or body fields).",
      },
      dryRun: {
        type: "boolean",
        description:
          "Preview the request (method, path, would-send body) without sending it. Works even in readOnly.",
      },
      confirm: {
        type: "boolean",
        description:
          "Required to execute a high-risk (destructive/irreversible) operation — e.g. closeAllPositions, cancelAllOrders, withdrawal. Ignored for non-high-risk ops.",
      },
    },
    required: ["operationId"],
    additionalProperties: false,
  };
}

/**
 * The always-available escape hatch (design §J / P5).
 *
 * Reaches ANY catalog operation by id — including endpoints added to the spec
 * after the curated tier was written — reusing the client's signing, rate
 * limiting, and error decoding. Not module-scoped, so the agent is never
 * trapped.
 *
 * Crucially it routes through the SAME safety chokepoint as the curated verbs
 * (`executeWithSafety`): the escape hatch widens *scope*, it does not lower the
 * destructive bar. `readOnly` refusal, `dryRun` preview, and the high-risk
 * `confirm` gate all hold here identically — so an agent can't sidestep the
 * confirm requirement by reaching for `raw` instead of the curated verb.
 */
export function buildRawTool(_config: BitgetConfig): ToolSpec {
  return {
    name: RAW_TOOL_NAME,
    module: "core",
    domain: META_DOMAIN,
    fronts: [],
    method: "POST",
    path: "(dynamic)",
    auth: "private",
    // Tool-level marker; the *real* per-call risk is graded dynamically from
    // the resolved operation inside executeWithSafety.
    riskLevel: "read",
    isWrite: false,
    description:
      "[RAW] Escape hatch — invoke any v3 operation by operationId. Bypasses the curated surface but reuses signing, rate limiting, error decoding, AND the safety gate: honors readOnly, supports dryRun preview, and high-risk ops still require confirm.",
    inputSchema: rawInputSchema(),
    handler: async (args, context) => {
      const operationId = requireString(args, "operationId");
      const op = getOperation(operationId);
      if (!op) {
        throw new ValidationError(
          `Unknown operationId "${operationId}".`,
          "Use a valid id from the generated catalog (src/generated/catalog.ts).",
        );
      }
      // dryRun/confirm are reserved controls on raw's own input; lift them onto
      // the forwarded record so executeWithSafety can split them back out. The
      // gate then applies uniformly with the curated surface.
      const gated: Record<string, unknown> = { ...asRecord(args.args) };
      if (args.dryRun !== undefined) gated.dryRun = args.dryRun;
      if (args.confirm !== undefined) gated.confirm = args.confirm;
      return executeWithSafety(op, gated, context);
    },
  };
}
