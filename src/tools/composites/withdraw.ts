import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `withdraw` — send funds out by intent (design §C).
 *
 * Submit a withdrawal or list withdrawal records (paged). Withdrawal is a
 * high-risk write: it carries an auto `clientOid` (idempotency, P7) and the
 * shared safety gate requires `confirm` to execute it.
 */
export function buildWithdrawTool(): ToolSpec {
  return buildActionTool({
    name: "withdraw",
    domain: "funds",
    description:
      "[VERB] Withdrawals by intent: submit (send funds out — irreversible, needs confirm) | records (withdrawal history).",
    properties: {
      coin: { type: "string", description: "Coin to withdraw, e.g. USDT." },
      chain: { type: "string", description: "Chain/network for the withdrawal." },
      address: { type: "string", description: "Destination address." },
      amount: { type: "string", description: "Amount to withdraw." },
      clientOid: {
        type: "string",
        description: "Idempotency key. Auto-generated for `submit` when omitted (P7).",
      },
    },
    actions: {
      submit: {
        operationId: "withdrawal",
        kind: "write",
        description: "submit a withdrawal (irreversible)",
        autoClientOid: true,
      },
      records: { operationId: "getWithdrawalRecords", kind: "readPaged", description: "withdrawal history" },
    },
  });
}
