import { getOperation, type CatalogOperation } from "../../generated/catalog.js";
import { ValidationError } from "../../utils/errors.js";
import { assertEnum, readBoolean, readStringArray } from "../helpers.js";
import { applyView, type ResultView, type ViewOptions } from "../normalize.js";
import { fetchAllPages, type PaginateOptions } from "../paginate.js";
import { requiredForOperation } from "../param-schema.js";
import { splitControls } from "../safety.js";
import type { ToolContext, ToolResult } from "../types.js";

/**
 * Reserved keys that belong to the composite layer itself and must NOT be
 * forwarded to the catalog operation as path/query/body params. Every
 * action-routed verb dispatches on `action`; `preflight` is transfer's
 * read-before-write probe; `view`/`fields`/`fetchAll` shape the response.
 */
export const COMPOSITE_CONTROL_KEYS = [
  "action",
  "view",
  "fields",
  "fetchAll",
  "preflight",
] as const;

/** Args with composite controls removed (dry-run/confirm kept for writes). */
export function forwardArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...args };
  for (const key of COMPOSITE_CONTROL_KEYS) delete rest[key];
  return rest;
}

/** Args for a read path: composite controls AND safety controls removed. */
export function readArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  return splitControls(forwardArgs(args)).rest;
}

/** Read the shared view/projection options off a composite's args. */
export function readViewOptions(args: Record<string, unknown>): ViewOptions {
  const view = assertEnum(args, "view", ["summary", "full"] as const) as
    | ResultView
    | undefined;
  const fields = readStringArray(args, "fields");
  return { view, fields };
}

/** Resolve a routed operationId to its catalog entry, or fail loudly. */
export function requireOperation(operationId: string): CatalogOperation {
  const op = getOperation(operationId);
  if (!op) {
    throw new ValidationError(
      `Composite routed to unknown operationId "${operationId}".`,
      "Internal routing error — the spec may have changed; regenerate the catalog.",
    );
  }
  return op;
}

/** Call a read operation and apply the normalization view to its payload. */
export async function callRead(
  context: ToolContext,
  operationId: string,
  wireArgs: Record<string, unknown>,
  viewOptions: ViewOptions,
): Promise<ToolResult> {
  const result = await context.client.callOperation(operationId, wireArgs);
  return {
    endpoint: result.endpoint,
    requestTime: result.requestTime,
    data: applyView(result.data, viewOptions),
  };
}

/**
 * Read a cursor-paged list. When the caller passes `fetchAll: true`, walk the
 * cursor to (bounded) completion and return `{ items, pages, truncated }`;
 * otherwise return a single normalized page.
 */
export async function readMaybeAll(
  context: ToolContext,
  operationId: string,
  args: Record<string, unknown>,
  viewOptions: ViewOptions,
  paginate: PaginateOptions = { cursorParam: "cursor", pageSizeParam: "limit" },
): Promise<ToolResult> {
  const op = requireOperation(operationId);
  const wire = readArgs(args);
  if (readBoolean(args, "fetchAll") === true) {
    const { items, pages, truncated } = await fetchAllPages(
      context.client,
      operationId,
      wire,
      paginate,
    );
    return {
      endpoint: `${op.method} ${op.path}`,
      requestTime: new Date().toISOString(),
      data: { items: applyView(items, viewOptions), pages, truncated },
    };
  }
  return callRead(context, operationId, wire, viewOptions);
}

/** Shared JSON-schema fragment for the view / projection controls. */
export const VIEW_SCHEMA_PROPS: Record<string, unknown> = {
  view: {
    type: "string",
    enum: ["summary", "full"],
    description:
      "summary (default) trims null fields to save tokens; full returns the untouched payload.",
  },
  fields: {
    description:
      "Optional list (array or comma-separated string) of fields to keep on each returned row.",
  },
};

/** One action's contribution to an `action` enum's description. */
export interface ActionDocEntry {
  /** The `action` enum value. */
  name: string;
  /** Catalog operationId this action routes to. */
  operationId: string;
  /** One-line, agent-facing description for this action. */
  description: string;
}

/**
 * Compose an `action` enum's description, tagging each action with a
 * `(needs: …)` hint — its routed operation's required params (control keys
 * removed), read from the catalog (the single source of truth). This keeps the
 * precise per-action required set machine-readable on a verb's flat schema, so
 * an agent reading discover({ tool }) sees what each action needs without first
 * drilling to discover({ tool, action }). Shared by the declarative builder and
 * the hand-written verbs so every action-routed tool reads the same way.
 */
export function composeActionDoc(entries: ActionDocEntry[]): string {
  const controlKeys = new Set<string>(COMPOSITE_CONTROL_KEYS);
  return entries
    .map(({ name, operationId, description }) => {
      const needs = requiredForOperation(operationId).filter(
        (param) => !controlKeys.has(param),
      );
      const tail = needs.length ? ` (needs: ${needs.join(", ")})` : "";
      return `${name}: ${description}${tail}`;
    })
    .join(" | ");
}
