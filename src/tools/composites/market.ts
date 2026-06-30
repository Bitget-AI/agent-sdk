import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `market` — public market data by intent (design §C).
 *
 * One read-only verb over every market-module endpoint: prices, books, klines,
 * funding, open interest, and the various reference/reserve reads. Needs no
 * credentials, so it is available in every surface and in readOnly mode.
 */
export function buildMarketTool(): ToolSpec {
  return buildActionTool({
    name: "market",
    domain: "market",
    auth: "public",
    description:
      "[VERB] Public market data: tickers, orderbook, candles, instruments, funding rate, open interest, recent fills, and reference reads (no credentials required).",
    properties: {
      category: { type: "string", description: "Product category, e.g. SPOT or USDT-FUTURES." },
      symbol: { type: "string", description: "Trading pair, e.g. BTCUSDT." },
      coin: { type: "string", description: "Coin filter where applicable, e.g. USDT." },
      limit: { description: "Max rows to return." },
      startTime: { description: "Range start (ms epoch) for candles/history." },
      endTime: { description: "Range end (ms epoch) for candles/history." },
    },
    actions: {
      tickers: { operationId: "getTickers", kind: "read", description: "ticker snapshot for a category/symbol" },
      orderbook: { operationId: "getOrderbook", kind: "read", description: "order book depth" },
      candles: { operationId: "getKlineCandlestick", kind: "read", description: "recent klines" },
      candlesHistory: { operationId: "getKlineCandlestickHistory", kind: "read", description: "historical klines" },
      instruments: { operationId: "getInstruments", kind: "read", description: "tradable instrument metadata" },
      fundingRate: { operationId: "getCurrentFundingRate", kind: "read", description: "current funding rate" },
      fundingRateHistory: { operationId: "getFundingRateHistory", kind: "read", description: "historical funding rates" },
      openInterest: { operationId: "getOpenInterest", kind: "read", description: "current open interest" },
      openInterestLimit: { operationId: "getOpenInterestLimit", kind: "read", description: "open-interest limit" },
      recentFills: { operationId: "getRecentPublicFills", kind: "read", description: "recent public trades" },
      positionTier: { operationId: "getPositionTier", kind: "read", description: "position/leverage tiers" },
      discountRate: { operationId: "getDiscountRate", kind: "read", description: "collateral discount rates" },
      indexComponents: { operationId: "getIndexPriceComponents", kind: "read", description: "index price components" },
      marginLoan: { operationId: "getMarginLoan", kind: "read", description: "margin-loan reference data" },
      proofOfReserves: { operationId: "getProofOfReserves", kind: "read", description: "proof-of-reserves" },
      riskReserve: { operationId: "getRiskReserve", kind: "read", description: "risk reserve fund" },
    },
  });
}
