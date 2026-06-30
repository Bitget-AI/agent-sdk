import type { BitgetRestClient } from "../client/rest-client.js";

/**
 * Cursor pagination / fetch-all (design §F / P2).
 *
 * Bitget v3 list endpoints are cursor-paged: each page echoes a batch and the
 * caller advances by passing the last id back. Agents should not hand-roll that
 * loop (it is the classic place to either stop one page early or fetch forever),
 * so this walks the cursor for them — bounded by a hard page cap AND a total
 * item cap, and reporting `truncated` so the agent knows more may exist.
 */

export interface PaginateOptions {
  /** Max pages to fetch before stopping (default 5). */
  pageCap?: number;
  /** Max items to accumulate before stopping (default 500). */
  totalCap?: number;
  /** Request param that carries the cursor (default "cursor"). */
  cursorParam?: string;
  /** Response item field to read the next cursor from (default: id-like keys). */
  cursorField?: string;
  /** Request param controlling page size (default "limit"). */
  pageSizeParam?: string;
  /** Value for the page-size param, if the endpoint supports it. */
  pageSize?: number;
  /** Field on an object payload that wraps the item array (default: common keys). */
  itemsField?: string;
}

export interface PaginateResult {
  items: unknown[];
  pages: number;
  /** True when a cap stopped the walk before the natural end of the data. */
  truncated: boolean;
}

const WRAPPER_KEYS = ["list", "orderList", "fills", "rows", "data"] as const;
const CURSOR_KEYS = ["endId", "cursor", "orderId", "id", "tradeId", "billId"] as const;

/** Pull the item array out of a page payload (array, or common object wrapper). */
function extractItems(data: unknown, itemsField?: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (itemsField && Array.isArray(record[itemsField])) {
      return record[itemsField] as unknown[];
    }
    for (const key of WRAPPER_KEYS) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

/** Derive the cursor for the next request from the last item of a page. */
function nextCursor(items: unknown[], cursorField?: string): string | undefined {
  const last = items[items.length - 1];
  if (!last || typeof last !== "object") return undefined;
  const record = last as Record<string, unknown>;
  if (cursorField) {
    const value = record[cursorField];
    return value === undefined || value === null ? undefined : String(value);
  }
  for (const key of CURSOR_KEYS) {
    const value = record[key];
    if (value !== undefined && value !== null) return String(value);
  }
  return undefined;
}

/**
 * Walk a cursor-paged operation to (bounded) completion.
 *
 * Stops on the first of: an empty page, no advancing cursor, the total cap, or
 * the page cap. `truncated` is true only when a cap cut the walk short while
 * more data was still likely available.
 */
export async function fetchAllPages(
  client: Pick<BitgetRestClient, "callOperation">,
  operationId: string,
  baseArgs: Record<string, unknown> = {},
  options: PaginateOptions = {},
): Promise<PaginateResult> {
  const pageCap = options.pageCap ?? 5;
  const totalCap = options.totalCap ?? 500;
  const cursorParam = options.cursorParam ?? "cursor";
  const pageSizeParam = options.pageSizeParam ?? "limit";

  const items: unknown[] = [];
  let pages = 0;
  let cursor: string | undefined;
  let truncated = false;

  while (pages < pageCap) {
    const args: Record<string, unknown> = { ...baseArgs };
    if (options.pageSize !== undefined) args[pageSizeParam] = options.pageSize;
    if (cursor !== undefined) args[cursorParam] = cursor;

    const result = await client.callOperation(operationId, args);
    const pageItems = extractItems(result.data, options.itemsField);
    pages += 1;

    if (pageItems.length === 0) break;

    let capped = false;
    for (const item of pageItems) {
      if (items.length >= totalCap) {
        truncated = true;
        capped = true;
        break;
      }
      items.push(item);
    }
    if (capped) break;

    const next = nextCursor(pageItems, options.cursorField);
    if (next === undefined || next === cursor) break;
    cursor = next;

    if (pages >= pageCap) {
      truncated = true;
      break;
    }
  }

  return { items, pages, truncated };
}
