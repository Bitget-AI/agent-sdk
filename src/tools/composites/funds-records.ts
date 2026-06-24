import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `funds_records` — read-only money trail by intent (design §C).
 *
 * The financial / convert / main-sub transfer ledgers plus the transferable-coin
 * reference. All reads; ledgers paginate via `fetchAll`. Moving funds lives in
 * `transfer_funds` / `deposit` / `withdraw`; this verb only reports history.
 */
export function buildFundsRecordsTool(): ToolSpec {
  return buildActionTool({
    name: "funds_records",
    domain: "funds",
    description:
      "[VERB] Funds history (read-only): financial ledger | convert records | main↔sub transfer records | transferableCoins.",
    properties: {
      coin: { type: "string", description: "Coin filter, e.g. USDT." },
      startTime: { description: "Range start (ms epoch)." },
      endTime: { description: "Range end (ms epoch)." },
    },
    actions: {
      financial: { operationId: "getFinancialRecords", kind: "readPaged", description: "financial (bill) ledger" },
      convert: { operationId: "getConvertRecords", kind: "readPaged", description: "convert history" },
      subTransfers: {
        operationId: "getTheTransferRecordsOfMainSubAccount",
        kind: "readPaged",
        description: "main↔sub transfer records",
      },
      transferableCoins: { operationId: "getTransferableCoins", kind: "read", description: "coins eligible for transfer" },
    },
  });
}
