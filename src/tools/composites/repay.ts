import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `repay` — repay unified-account liabilities by intent (design §C).
 *
 * The `repay` write plus its `repayable` companion read (which coins/amounts
 * can be repaid). The write flows through the shared safety gate.
 */
export function buildRepayTool(): ToolSpec {
  return buildActionTool({
    // NB: named `repayment`, not `repay`, because `repay` is already a catalog
    // operationId — the 1:1 generated tier owns that name (zero-drift), same as
    // `transfer`/`transfer_funds`.
    name: "repayment",
    domain: "account",
    description:
      "[VERB] Repay account liabilities: submit a repayment, or list repayable coins/amounts.",
    properties: {
      coin: { type: "string", description: "Coin to repay, e.g. USDT." },
      amount: { type: "string", description: "Amount to repay." },
    },
    actions: {
      submit: { operationId: "repay", kind: "write", description: "repay a liability" },
      repayable: { operationId: "getRepayableCoins", kind: "read", description: "list repayable coins/amounts" },
    },
  });
}
