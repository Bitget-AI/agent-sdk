import { randomUUID } from "node:crypto";
import { assertEnum, readObjectArray } from "../helpers.js";
import { mergeProjected, projectUnion } from "../param-schema.js";
import { executeWithSafety } from "../safety.js";
import type { JsonSchema, ToolResult, ToolSpec } from "../types.js";
import {
  VIEW_SCHEMA_PROPS,
  callRead,
  composeActionDoc,
  forwardArgs,
  readArgs,
  readMaybeAll,
  readViewOptions,
  requireOperation,
} from "./shared.js";

export const ORDER_ACTIONS = [
  "place",
  "cancel",
  "modify",
  "cancelAll",
  "countdownCancel",
  "open",
  "detail",
  "history",
  "fills",
  "maxOpen",
] as const;

/**
 * action → the SINGLE-order operation it primarily routes to. The batch
 * variants (batchOrder/batchCancel/batchModifyOrders) are reached by passing an
 * `orders` array, so they stay out of this map; `discover({ tool:"order",
 * action })` projects the single-order contract, which is the common path.
 */
const ORDER_ACTION_OPS: Record<(typeof ORDER_ACTIONS)[number], string> = {
  place: "placeOrder",
  cancel: "cancelOrder",
  modify: "modifyOrder",
  cancelAll: "cancelAllOrders",
  countdownCancel: "countdownCancelAll",
  open: "getOpenOrders",
  detail: "getOrderDetails",
  history: "getOrderHistory",
  fills: "getFillHistory",
  maxOpen: "getMaxOpenAvailable",
};

/** One-line, agent-facing description per action; the `(needs: …)` required-
 *  param hint is appended from the catalog by `composeActionDoc`. */
const ORDER_ACTION_DOCS: Record<(typeof ORDER_ACTIONS)[number], string> = {
  place: "place an order",
  cancel: "cancel an order",
  modify: "modify an order",
  cancelAll: "cancel all orders (destructive)",
  countdownCancel: "dead-man's-switch auto-cancel",
  open: "list open orders",
  detail: "one order's detail",
  history: "historical orders",
  fills: "fill history",
  maxOpen: "max openable size",
};

function orderSchema(): JsonSchema {
  // Catalog projection supplies the doc-grounded enums (side, orderType,
  // timeInForce, reduceOnly, posSide, the TP/SL set, …) and fills fields this
  // verb never hand-declared; the intent-tuned descriptions below win on
  // overlap. `orderList` is remapped from `orders` by the handler, so it is
  // dropped from the advertised face.
  const business = mergeProjected(projectUnion(Object.values(ORDER_ACTION_OPS)), {
    category: {
      type: "string",
      description: "Product category, e.g. SPOT or USDT-FUTURES.",
    },
    symbol: { type: "string", description: "Trading pair, e.g. BTCUSDT." },
    side: { type: "string", description: "buy or sell." },
    orderType: { type: "string", description: "limit or market." },
    price: { description: "Order price (limit orders)." },
    qty: { description: "Order size/quantity (the v3 API field name)." },
    orderId: { type: "string", description: "Target order id for cancel/modify/detail." },
    clientOid: {
      type: "string",
      description:
        "Idempotency key. Auto-generated for a single `place` when omitted (P7).",
    },
  });
  delete business.orderList;
  // `size` is getMaxOpenAvailable's quantity alias; this verb standardizes on
  // the v3 `qty` field, so the advertised face never shows two quantity inputs.
  delete business.size;

  return {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...ORDER_ACTIONS],
        description: `What to do — ${composeActionDoc(
          ORDER_ACTIONS.map((name) => ({
            name,
            operationId: ORDER_ACTION_OPS[name],
            description: ORDER_ACTION_DOCS[name],
          })),
        )}. Pass \`orders\` to batch place/cancel/modify.`,
      },
      ...business,
      orders: {
        type: "array",
        description:
          "Array of order/cancel/modify objects. When present, place/cancel/modify route to the batch endpoint automatically.",
      },
      fetchAll: {
        type: "boolean",
        description:
          "history/fills only: walk the cursor to bounded completion (returns { items, pages, truncated }).",
      },
      dryRun: {
        type: "boolean",
        description: "Preview the write without sending it.",
      },
      confirm: {
        type: "boolean",
        description: "Required to execute cancelAll (destructive).",
      },
      ...VIEW_SCHEMA_PROPS,
    },
    required: ["action"],
    additionalProperties: true,
  };
}

/**
 * `order` — the headline trading verb (design §C / P4).
 *
 * One intent-shaped tool that fans out to the dozen order/fill catalog
 * operations: single↔batch is chosen by the presence of an `orders` array,
 * a `clientOid` is injected for single placement (idempotency, P7), reads are
 * normalized and optionally paginated, and every write flows through the same
 * dryRun/confirm/readOnly safety gate as the generated tier.
 */
export function buildOrderTool(): ToolSpec {
  return {
    name: "order",
    module: "core",
    domain: "trade",
    fronts: [
      "placeOrder",
      "batchOrder",
      "cancelOrder",
      "batchCancel",
      "modifyOrder",
      "batchModifyOrders",
      "cancelAllOrders",
      "countdownCancelAll",
      "getOpenOrders",
      "getOrderDetails",
      "getOrderHistory",
      "getFillHistory",
      "getMaxOpenAvailable",
    ],
    actions: ORDER_ACTION_OPS,
    method: "POST",
    path: "(composite)",
    auth: "private",
    isWrite: false,
    riskLevel: "write",
    description:
      "[VERB] Manage orders by intent: place/cancel/modify (single or batch via `orders`), cancelAll, countdownCancel, plus open/detail/history/fills reads. Writes honor dryRun/confirm/readOnly; cancelAll requires confirm.",
    inputSchema: orderSchema(),
    handler: async (args, context): Promise<ToolResult> => {
      const action = assertEnum(args, "action", ORDER_ACTIONS, {
        required: true,
      })!;
      const viewOptions = readViewOptions(args);

      switch (action) {
        case "place": {
          const orders = readObjectArray(args, "orders");
          if (orders) {
            const writeArgs = forwardArgs(args);
            delete writeArgs.orders;
            writeArgs.orderList = orders.map((order) =>
              order.clientOid ? order : { ...order, clientOid: randomUUID() },
            );
            return executeWithSafety(
              requireOperation("batchOrder"),
              writeArgs,
              context,
            );
          }
          const single = forwardArgs(args);
          if (!single.clientOid) single.clientOid = randomUUID();
          return executeWithSafety(
            requireOperation("placeOrder"),
            single,
            context,
          );
        }

        case "cancel": {
          const orders = readObjectArray(args, "orders");
          const writeArgs = forwardArgs(args);
          if (orders) {
            delete writeArgs.orders;
            writeArgs.orderList = orders;
            return executeWithSafety(
              requireOperation("batchCancel"),
              writeArgs,
              context,
            );
          }
          return executeWithSafety(
            requireOperation("cancelOrder"),
            writeArgs,
            context,
          );
        }

        case "modify": {
          const orders = readObjectArray(args, "orders");
          const writeArgs = forwardArgs(args);
          if (orders) {
            delete writeArgs.orders;
            writeArgs.orderList = orders;
            return executeWithSafety(
              requireOperation("batchModifyOrders"),
              writeArgs,
              context,
            );
          }
          return executeWithSafety(
            requireOperation("modifyOrder"),
            writeArgs,
            context,
          );
        }

        case "cancelAll":
          return executeWithSafety(
            requireOperation("cancelAllOrders"),
            forwardArgs(args),
            context,
          );

        case "countdownCancel":
          return executeWithSafety(
            requireOperation("countdownCancelAll"),
            forwardArgs(args),
            context,
          );

        case "open":
          return callRead(context, "getOpenOrders", readArgs(args), viewOptions);

        case "detail":
          return callRead(
            context,
            "getOrderDetails",
            readArgs(args),
            viewOptions,
          );

        case "history":
          return readMaybeAll(context, "getOrderHistory", args, viewOptions);

        case "fills":
          return readMaybeAll(context, "getFillHistory", args, viewOptions);

        case "maxOpen":
          return callRead(
            context,
            "getMaxOpenAvailable",
            readArgs(args),
            viewOptions,
          );
      }
    },
  };
}
