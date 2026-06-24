import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `strategy_order` — trigger / TP-SL / plan orders by intent (design §C).
 *
 * The strategy-order lifecycle (place / cancel / modify) plus its open and
 * history reads. Writes flow through the shared safety gate; `place` gets an
 * auto `clientOid` for idempotency (P7), mirroring the spot/futures `order` verb.
 */
export function buildStrategyOrderTool(): ToolSpec {
  return buildActionTool({
    name: "strategy_order",
    domain: "trade",
    description:
      "[VERB] Strategy (trigger/plan) orders by intent: place | cancel | modify | open (unfilled) | history. Writes honor dryRun/confirm/readOnly.",
    properties: {
      category: { type: "string", description: "Product category, e.g. USDT-FUTURES." },
      symbol: { type: "string", description: "Trading pair, e.g. BTCUSDT." },
      orderId: { type: "string", description: "Target strategy order id for cancel/modify." },
      clientOid: {
        type: "string",
        description: "Idempotency key. Auto-generated for `place` when omitted (P7).",
      },
    },
    actions: {
      place: {
        operationId: "placeStrategyOrder",
        kind: "write",
        description: "create a strategy order",
        autoClientOid: true,
      },
      cancel: { operationId: "cancelStrategyOrder", kind: "write", description: "cancel a strategy order" },
      modify: { operationId: "modifyStrategyOrder", kind: "write", description: "modify a strategy order" },
      open: { operationId: "unfilledStrategyOrders", kind: "read", description: "list unfilled strategy orders" },
      history: { operationId: "historyStrategyOrders", kind: "readPaged", description: "strategy order history" },
    },
  });
}
