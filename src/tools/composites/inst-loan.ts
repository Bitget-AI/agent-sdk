import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `inst_loan` — institutional (VIP) loans by intent (design §C).
 *
 * Bind/unbind a uid to a risk unit (the one write) plus the loan-order, LTV,
 * product, repayment, risk-unit, symbol, and transferred-quantity reads.
 */
export function buildInstLoanTool(): ToolSpec {
  return buildActionTool({
    name: "inst_loan",
    domain: "instloan",
    description:
      "[VERB] Institutional loans by intent: bindUid (risk unit) | orders | ltv | marginCoins | products | repaymentOrders | riskUnit | symbols | transferred.",
    properties: {
      coin: { type: "string", description: "Coin filter where applicable." },
      orderId: { type: "string", description: "Target loan order id where applicable." },
    },
    actions: {
      bindUid: { operationId: "bindUnbindUidToRiskUnit", kind: "write", description: "bind/unbind a uid to a risk unit" },
      orders: { operationId: "getLoanOrders", kind: "readPaged", description: "loan orders" },
      ltv: { operationId: "getLtv", kind: "read", description: "current loan-to-value" },
      marginCoins: { operationId: "getMarginCoinInfo", kind: "read", description: "margin-coin info" },
      products: { operationId: "getProductInfo", kind: "read", description: "loan product info" },
      repaymentOrders: { operationId: "getRepaymentOrders", kind: "readPaged", description: "repayment orders" },
      riskUnit: { operationId: "getRiskUnit", kind: "read", description: "risk-unit info" },
      symbols: { operationId: "getTradeSymbols", kind: "read", description: "tradable symbols under the loan" },
      transferred: { operationId: "getTransferredQuantity", kind: "read", description: "transferred quantity" },
    },
  });
}
