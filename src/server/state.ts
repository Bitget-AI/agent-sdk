export interface MockOrder {
  orderId: string;
  clientOid?: string;
  symbol: string;
  category: string;
  side: string;
  orderType: string;
  price: string;
  size: string;
  status: string;
  filledSize: string;
  cTime: string;
  uTime: string;
  [key: string]: unknown;
}

export interface ErrorOverride {
  code: string;
  msg: string;
}

export interface MockState {
  /** Live + historical orders, keyed by orderId. */
  orders: Map<string, MockOrder>;
  /** Account asset rows returned by getAccountAssets. */
  balances: Record<string, unknown>[];
  /** Force a Bitget error envelope for a given `METHOD path` key. */
  errorOverrides: Map<string, ErrorOverride>;
  /** Override the `data` payload for a given operationId. */
  responseOverrides: Map<string, unknown>;
  counter: number;
}

export function createEmptyState(): MockState {
  return {
    orders: new Map(),
    balances: [],
    errorOverrides: new Map(),
    responseOverrides: new Map(),
    counter: 0,
  };
}

export function nextId(state: MockState, prefix: string): string {
  state.counter += 1;
  return `${prefix}-${Date.now()}-${state.counter}`;
}
