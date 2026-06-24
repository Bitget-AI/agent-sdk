/**
 * Response normalization & token economy (design §E / P2).
 *
 * Raw v3 payloads are verbose and littered with null/empty fields that burn
 * context tokens without informing a decision. `summary` (the default) trims
 * those nulls; `full` returns untouched fidelity. Per-tool `summaryFields` or a
 * caller-supplied `fields` list narrow further.
 *
 * Guardrail (design §6): never over-trim. Summary only removes nulls unless a
 * field projection is explicitly requested, and `full` is always reachable, so
 * the agent can never be starved of data it needs.
 */

export type ResultView = "summary" | "full";

export interface ViewOptions {
  /** "summary" (default) null-trims; "full" returns the payload untouched. */
  view?: ResultView;
  /** Caller-supplied projection — wins over the view when non-empty. */
  fields?: string[];
  /** Tool-supplied default projection applied only in summary view. */
  summaryFields?: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively drop null/undefined values from objects (arrays preserved). */
export function trimNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(trimNulls);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (inner === null || inner === undefined) continue;
      out[key] = trimNulls(inner);
    }
    return out;
  }
  return value;
}

/**
 * Keep only `fields` on an object, or on each object of an array. Non-object
 * values (and arrays of scalars) pass through untouched. An empty field list is
 * a no-op so callers can pass it unconditionally.
 */
export function projectFields(value: unknown, fields: string[]): unknown {
  if (fields.length === 0) return value;
  const pick = (object: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in object) out[field] = object[field];
    }
    return out;
  };
  if (Array.isArray(value)) {
    return value.map((item) => (isPlainObject(item) ? pick(item) : item));
  }
  if (isPlainObject(value)) return pick(value);
  return value;
}

/**
 * Apply the requested view to a response payload. Precedence:
 *   1. explicit `fields` → trim nulls, then project to exactly those fields.
 *   2. `view: "full"`    → return the payload untouched (full fidelity).
 *   3. `view: "summary"` → trim nulls; if the tool supplied `summaryFields`,
 *                          project to those.
 */
export function applyView(data: unknown, options: ViewOptions = {}): unknown {
  const view = options.view ?? "summary";

  if (options.fields && options.fields.length > 0) {
    return projectFields(trimNulls(data), options.fields);
  }

  if (view === "full") {
    return data;
  }

  const trimmed = trimNulls(data);
  if (options.summaryFields && options.summaryFields.length > 0) {
    return projectFields(trimmed, options.summaryFields);
  }
  return trimmed;
}
