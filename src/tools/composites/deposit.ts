import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `deposit` — manage incoming funds by intent (design §C).
 *
 * Fetch a deposit address, list deposit records (paged), or set up the deposit
 * account. The setup write flows through the shared safety gate.
 */
export function buildDepositTool(): ToolSpec {
  return buildActionTool({
    name: "deposit",
    domain: "funds",
    description:
      "[VERB] Deposits by intent: address (get a deposit address) | records (deposit history) | setupAccount.",
    properties: {
      coin: { type: "string", description: "Coin to deposit, e.g. USDT." },
      chain: { type: "string", description: "Chain/network for the deposit address." },
    },
    actions: {
      address: { operationId: "getDepositAddress", kind: "read", description: "get a deposit address" },
      records: { operationId: "getDepositRecords", kind: "readPaged", description: "deposit history" },
      setupAccount: { operationId: "setUpDepositAccount", kind: "write", description: "configure the deposit account" },
    },
  });
}
