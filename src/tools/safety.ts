import type { CatalogOperation } from "../generated/catalog.js";
import { ValidationError } from "../utils/errors.js";
import { compactObject } from "./helpers.js";
import { riskLevelOf } from "./risk.js";
import type { RiskLevel, ToolContext, ToolResult } from "./types.js";

/**
 * Write-safety middleware (design §H / P3).
 *
 * A single chokepoint every write flows through — the generic per-operation
 * tools AND the curated composite verbs — so the dry-run, readOnly, and
 * destructive-confirm guarantees hold uniformly no matter which surface the
 * agent reached for. Risk is graded off the catalog, never hand-maintained.
 */

export interface SafetyControls {
  /** Preview the request instead of sending it. */
  dryRun: boolean;
  /** Required to execute a high-risk (destructive/irreversible) operation. */
  confirm: boolean;
  /** Args with the control keys removed — what actually goes on the wire. */
  rest: Record<string, unknown>;
}

/** Pull the reserved control params out of the args before they hit the wire. */
export function splitControls(args: Record<string, unknown>): SafetyControls {
  const rest: Record<string, unknown> = { ...args };
  const dryRun = rest.dryRun === true || rest.dryRun === "true";
  const confirm = rest.confirm === true || rest.confirm === "true";
  delete rest.dryRun;
  delete rest.confirm;
  return { dryRun, confirm, rest };
}

function previewResult(
  op: CatalogOperation,
  riskLevel: RiskLevel,
  rest: Record<string, unknown>,
): ToolResult {
  return {
    endpoint: `${op.method} ${op.path}`,
    requestTime: new Date().toISOString(),
    data: {
      dryRun: true,
      operationId: op.operationId,
      method: op.method,
      path: op.path,
      riskLevel,
      wouldSend: compactObject(rest),
    },
  };
}

function confirmationRequiredResult(
  op: CatalogOperation,
  riskLevel: RiskLevel,
): ToolResult {
  return {
    endpoint: `${op.method} ${op.path}`,
    requestTime: new Date().toISOString(),
    data: {
      confirmationRequired: true,
      operationId: op.operationId,
      riskLevel,
      message: `"${op.operationId}" is destructive or irreversible and was not executed.`,
      hint: "Re-call with confirm: true to proceed, or dryRun: true to preview the request.",
    },
  };
}

/**
 * Execute a catalog operation behind the safety gates, in order:
 *   1. dryRun  → return the would-send request, no network (allowed in readOnly).
 *   2. readOnly + write → refuse (fixable error).
 *   3. high-risk without confirm → return { confirmationRequired: true }, no network.
 *   4. otherwise → call the operation.
 */
export async function executeWithSafety(
  op: CatalogOperation,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const { dryRun, confirm, rest } = splitControls(args);
  const riskLevel = riskLevelOf(op);

  if (dryRun) {
    return previewResult(op, riskLevel, rest);
  }

  if (context.config.readOnly && op.isWrite) {
    throw new ValidationError(
      `Operation "${op.operationId}" is a write and readOnly mode is enabled.`,
      "Disable readOnly to perform writes, or call a read-only operation.",
    );
  }

  if (riskLevel === "high" && !confirm) {
    return confirmationRequiredResult(op, riskLevel);
  }

  const result = await context.client.callOperation(op.operationId, rest);
  return {
    endpoint: result.endpoint,
    requestTime: result.requestTime,
    data: result.data,
  };
}
