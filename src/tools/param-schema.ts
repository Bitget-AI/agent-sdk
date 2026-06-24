import { getOperation, type CatalogOperation, type CatalogParam } from "../generated/catalog.js";
import { fieldSchema } from "./field-schemas.js";

/**
 * Catalog → JSON-Schema projection (design §A / single-source-of-truth).
 *
 * The catalog now carries doc-grounded `type`/`enum`/`description` for every
 * enriched operation (written back into openapi.yaml). These helpers turn that
 * metadata into the JSON-Schema fragments the tool surface advertises, so a
 * spec change propagates to every inputSchema with zero hand-editing.
 *
 * Layering: catalog metadata wins (it is per-operation truth — e.g. `category`
 * on a futures-only write lists no SPOT), and `field-schemas.ts` is demoted to a
 * thin FALLBACK that fills gaps the catalog still lacks (un-enriched ops, the
 * curated identifier hints like clientOid/cursor/chain).
 *
 * Body fields mirror the catalog's doc-grounded `type`: the docs params table
 * distinguishes scalar strings from arrays (repayableCoinList/paymentCoinList →
 * `array`), so emitting `param.type` types scalars like qty/price as `string`
 * while keeping array fields as `array` — a strict validator then accepts what
 * the API requires. For an op the catalog never enriched, enum presence still
 * implies a scalar string and field-schemas can fill a curated type; absent all
 * three the field stays untyped (permissive beats a wrong guess).
 */

export type ParamLocation = "path" | "query" | "body";

type ParamMeta = Pick<CatalogParam, "type" | "enum" | "description">;

function defaultDescription(name: string, location: ParamLocation): string {
  if (location === "path") return `Path parameter ${name}.`;
  if (location === "query") return `Query parameter ${name}.`;
  return `Body field ${name}.`;
}

/**
 * Project one parameter into a fresh JSON-Schema fragment. Catalog metadata
 * leads; the curated field-schema fills any gap (and, for body params with no
 * catalog enum, may still contribute a vetted type).
 */
export function projectParam(
  name: string,
  param: ParamMeta | undefined,
  location: ParamLocation,
): Record<string, unknown> {
  const curated = fieldSchema(name);

  const catalogEnum =
    param?.enum && param.enum.length ? [...param.enum] : undefined;
  const enumVals =
    catalogEnum ?? (curated?.enum ? [...curated.enum] : undefined);

  const description =
    (param?.description && param.description.length
      ? param.description
      : undefined) ??
    curated?.description ??
    defaultDescription(name, location);

  let type: string | undefined;
  if (location === "body") {
    // Single-source: trust the catalog's doc-grounded type. The docs params
    // table distinguishes genuine arrays (repayableCoinList/paymentCoinList →
    // "array") from scalar strings, so mirroring param.type types qty/price/
    // takeProfit as "string" AND keeps array fields as "array" — retiring the
    // old enum-only guard that left every non-enum scalar untyped. For an op the
    // catalog never enriched, enum presence still implies a scalar string, then
    // a curated field-schema type, else untyped.
    type = param?.type ?? (enumVals ? "string" : curated?.type);
  } else {
    // path/query are scalar by construction; the spec's string type is correct.
    type = param?.type ?? curated?.type ?? "string";
  }

  const fragment: Record<string, unknown> = {};
  if (type) fragment.type = type;
  if (enumVals) fragment.enum = enumVals;
  fragment.description = description;
  return fragment;
}

export interface ProjectedOperation {
  /** Param name → JSON-Schema fragment, in path → query → body order. */
  properties: Record<string, Record<string, unknown>>;
  /** Names the operation requires (path always; query/body when flagged). */
  required: string[];
}

/** Project a single catalog operation's full parameter contract. */
export function projectOperation(op: CatalogOperation): ProjectedOperation {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  const requireOnce = (name: string) => {
    if (!required.includes(name)) required.push(name);
  };

  for (const name of op.pathParams) {
    properties[name] = projectParam(name, undefined, "path");
    requireOnce(name);
  }
  for (const param of op.queryParams) {
    properties[param.name] = projectParam(param.name, param, "query");
    if (param.required) requireOnce(param.name);
  }
  for (const param of op.bodyParams) {
    properties[param.name] = projectParam(param.name, param, "body");
    if (param.required) requireOnce(param.name);
  }
  return { properties, required };
}

function unionEnum(a: unknown, b: unknown): string[] | undefined {
  const av = Array.isArray(a) ? (a as string[]) : [];
  const bv = Array.isArray(b) ? (b as string[]) : [];
  if (!av.length && !bv.length) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...av, ...bv]) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Merge two fragments for the SAME param appearing across several operations of
 * one intent tool. The static (flat) face is deliberately permissive: enums are
 * UNIONED to the superset so no per-action value is ever rejected at the tool
 * level — the precise per-action subset lives in `discover({ tool, action })`.
 */
function mergeFragment(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...a };
  if (!merged.type && b.type) merged.type = b.type;
  const en = unionEnum(a.enum, b.enum);
  if (en) merged.enum = en;
  if (!merged.description && b.description) merged.description = b.description;
  return merged;
}

/**
 * Project the union of several operations' params into one property map (used by
 * the action-routed intent tools, whose `action` switch spans many ops).
 * Unknown operationIds are skipped — `fronts` is asserted complete elsewhere.
 */
export function projectUnion(
  operationIds: Iterable<string>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const id of operationIds) {
    const op = getOperation(id);
    if (!op) continue;
    const { properties } = projectOperation(op);
    for (const [name, fragment] of Object.entries(properties)) {
      out[name] = out[name] ? mergeFragment(out[name], fragment) : fragment;
    }
  }
  return out;
}

/**
 * Merge hand-authored intent properties OVER the catalog projection: the
 * catalog fills any field the author omitted and supplies the enum, while a
 * hand-authored `type`/`enum`/`description` (usually more intent-tuned) wins.
 * Returns a new object; inputs are never mutated.
 */
export function mergeProjected(
  projected: Record<string, Record<string, unknown>>,
  authored: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const names = new Set([
    ...Object.keys(projected),
    ...Object.keys(authored),
  ]);
  for (const name of names) {
    const p = projected[name];
    const a = authored[name];
    if (p && a && typeof a === "object" && !Array.isArray(a)) {
      out[name] = { ...p, ...(a as Record<string, unknown>) };
    } else {
      out[name] = a ?? p;
    }
  }
  return out;
}

/** The required params a caller must supply for one operation (for action docs). */
export function requiredForOperation(operationId: string): string[] {
  const op = getOperation(operationId);
  return op ? projectOperation(op).required : [];
}
