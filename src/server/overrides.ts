import type { MockHandler, MockHandlerContext } from "./router.js";
import { type MockOrder, nextId } from "./state.js";
import { INSTRUMENTS, TICKERS } from "./fixtures.js";

function str(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value);
}

function createOrder(ctx: MockHandlerContext, source: Record<string, unknown>): MockOrder {
  const now = Date.now().toString();
  const orderId = str(source.orderId) || nextId(ctx.state, "ORDER");
  const order: MockOrder = {
    orderId,
    clientOid: source.clientOid ? str(source.clientOid) : undefined,
    symbol: str(source.symbol, "BTCUSDT"),
    category: str(source.category, "SPOT"),
    side: str(source.side, "buy"),
    orderType: str(source.orderType, "limit"),
    price: str(source.price, "0"),
    size: str(source.size, "0"),
    status: "live",
    filledSize: "0",
    cTime: now,
    uTime: now,
  };
  ctx.state.orders.set(orderId, order);
  return order;
}

function ack(order: MockOrder): Record<string, unknown> {
  return { orderId: order.orderId, clientOid: order.clientOid ?? "" };
}

/**
 * Curated, stateful handlers that give realistic round-trip behaviour for the
 * operations tests exercise most. Every other operation falls back to
 * `defaultHandler`. Keying by operationId means these survive path changes.
 */
export const OVERRIDES: Record<string, MockHandler> = {
  getTickers: ({ query }) => {
    const symbol = query.get("symbol");
    return symbol ? TICKERS.filter((t) => t.symbol === symbol) : TICKERS;
  },
  getInstruments: ({ query }) => {
    const symbol = query.get("symbol");
    return symbol ? INSTRUMENTS.filter((i) => i.symbol === symbol) : INSTRUMENTS;
  },
  getOrderbook: ({ query }) => ({
    symbol: query.get("symbol") ?? "BTCUSDT",
    asks: [["50000.6", "1.2"], ["50001.0", "0.8"]],
    bids: [["50000.4", "1.5"], ["50000.0", "2.0"]],
    ts: Date.now().toString(),
  }),
  getKlineCandlestick: () => [
    ["1690000000000", "49000", "51000", "48500", "50000", "1234.5", "61725000"],
  ],

  getAccountAssets: ({ state }) => state.balances,
  getAccountFundingAssets: ({ state }) => state.balances,

  placeOrder: (ctx) => ack(createOrder(ctx, ctx.body)),
  batchOrder: (ctx) => {
    const list = Array.isArray(ctx.body.orderList) ? ctx.body.orderList : [];
    const successList = list.map((raw) =>
      ack(createOrder(ctx, raw as Record<string, unknown>)),
    );
    return { successList, failureList: [] };
  },
  getOpenOrders: ({ state }) =>
    [...state.orders.values()].filter((o) => o.status === "live"),
  getOrderHistory: ({ state }) => [...state.orders.values()],
  getOrderDetails: ({ query, state }) => {
    const id = query.get("orderId");
    const found = id ? state.orders.get(id) : undefined;
    return found ?? null;
  },
  cancelOrder: ({ body, state }) => {
    const id = str(body.orderId);
    const order = state.orders.get(id);
    if (order) {
      order.status = "cancelled";
      order.uTime = Date.now().toString();
    }
    return { orderId: id, clientOid: str(body.clientOid) };
  },
  cancelAllOrders: ({ state }) => {
    let count = 0;
    for (const order of state.orders.values()) {
      if (order.status === "live") {
        order.status = "cancelled";
        count += 1;
      }
    }
    return { cancelled: count };
  },
};

export function defaultHandler(): MockHandler {
  return ({ op }) => ({ operationId: op.operationId, stub: true });
}
