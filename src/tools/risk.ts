import type { CatalogOperation } from "../generated/catalog.js";
import type { RiskLevel } from "./types.js";

/**
 * Write-safety grading (design §H).
 *
 * Upgrades the catalog's binary `isWrite` into read < write < high. A `high`
 * operation is destructive or irreversible and must not run without an explicit
 * `confirm: true` (P3).
 *
 * Scope is deliberately the operations the design brief names as destructive —
 * bulk cancels/closes and any withdrawal. Extend only with operations whose
 * effect is irreversible or account-wide; `riskLevelOf` never grades a read as
 * high, so a stale entry here can only over-confirm, never under-confirm.
 */
export const HIGH_RISK_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "closeAllPositions",
  "cancelAllOrders",
  "withdrawal",
  "brokerSubaccountWithdrawal",
]);

/** Grade an operation: read (no write) < write < high (destructive). */
export function riskLevelOf(op: CatalogOperation): RiskLevel {
  if (!op.isWrite) return "read";
  if (HIGH_RISK_OPERATIONS.has(op.operationId)) return "high";
  return "write";
}
