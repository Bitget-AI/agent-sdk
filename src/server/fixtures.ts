import type { MockState } from "./state.js";

export const TICKERS: Record<string, unknown>[] = [
  {
    symbol: "BTCUSDT",
    category: "SPOT",
    lastPr: "50000.5",
    open24h: "49000",
    high24h: "51000",
    low24h: "48500",
    bidPr: "50000.4",
    askPr: "50000.6",
    baseVolume: "1234.5",
    quoteVolume: "61725000",
    ts: "1690000000000",
  },
  {
    symbol: "ETHUSDT",
    category: "SPOT",
    lastPr: "3000.25",
    open24h: "2950",
    high24h: "3050",
    low24h: "2900",
    bidPr: "3000.2",
    askPr: "3000.3",
    baseVolume: "9876.5",
    quoteVolume: "29629500",
    ts: "1690000000000",
  },
];

export const INSTRUMENTS: Record<string, unknown>[] = [
  {
    symbol: "BTCUSDT",
    category: "SPOT",
    baseCoin: "BTC",
    quoteCoin: "USDT",
    minOrderAmount: "0.0001",
    pricePrecision: "1",
    sizePrecision: "4",
    status: "online",
  },
];

export const BALANCES: Record<string, unknown>[] = [
  {
    coin: "USDT",
    available: "10000.00",
    frozen: "0",
    locked: "0",
    equity: "10000.00",
  },
  {
    coin: "BTC",
    available: "0.5",
    frozen: "0",
    locked: "0",
    equity: "0.5",
  },
];

export function seedState(state: MockState): void {
  state.balances = BALANCES.map((row) => ({ ...row }));
}
