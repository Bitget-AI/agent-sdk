import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `loan` — crypto loans by intent (design §C).
 *
 * Borrow / repay / adjust-pledge writes plus the ongoing, history, debt,
 * interest, and reference reads. Writes flow through the shared safety gate.
 */
export function buildLoanTool(): ToolSpec {
  return buildActionTool({
    name: "loan",
    domain: "loan",
    description:
      "[VERB] Crypto loans by intent: borrow | repay | revisePledge | ongoing | borrowHistory | repayHistory | debts | interest | reduces | coins | pledgeRateHistory.",
    properties: {
      coin: { type: "string", description: "Loan/pledge coin, e.g. USDT." },
      amount: { type: "string", description: "Amount to borrow/repay." },
      orderId: { type: "string", description: "Target loan order id where applicable." },
    },
    actions: {
      borrow: { operationId: "borrowCoins", kind: "write", description: "borrow coins" },
      repay: { operationId: "repayCoins", kind: "write", description: "repay a loan" },
      revisePledge: { operationId: "revisePledge", kind: "write", description: "add/reduce pledge" },
      ongoing: { operationId: "getBorrowOngoing", kind: "read", description: "ongoing borrows" },
      borrowHistory: { operationId: "getBorrowHistory", kind: "readPaged", description: "borrow history" },
      repayHistory: { operationId: "getRepayHistory", kind: "readPaged", description: "repayment history" },
      debts: { operationId: "getLoanDebts", kind: "read", description: "outstanding debts" },
      interest: { operationId: "getLoanInterest", kind: "read", description: "accrued interest" },
      reduces: { operationId: "getLoanReduces", kind: "read", description: "pledge-reduction records" },
      coins: { operationId: "getLoanCoins", kind: "read", description: "borrowable/pledgeable coins" },
      pledgeRateHistory: { operationId: "getPledgeRateHistory", kind: "readPaged", description: "pledge-rate history" },
    },
  });
}
