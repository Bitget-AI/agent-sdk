import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `tax` — unified-account tax records by intent (design §C).
 *
 * A single read over the tax-record endpoint, exposed as a verb so the intent
 * surface covers the tax module too; the ledger paginates via `fetchAll`.
 */
export function buildTaxTool(): ToolSpec {
  return buildActionTool({
    name: "tax",
    domain: "tax",
    description: "[VERB] Tax records (read-only): records lists unified-account tax records.",
    properties: {
      coin: { type: "string", description: "Coin filter, e.g. USDT." },
      startTime: { description: "Range start (ms epoch)." },
      endTime: { description: "Range end (ms epoch)." },
    },
    actions: {
      records: { operationId: "getUnifiedAccountTaxRecords", kind: "readPaged", description: "unified-account tax records" },
    },
  });
}
