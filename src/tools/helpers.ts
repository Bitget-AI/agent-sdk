import { ValidationError } from "../utils/errors.js";

/**
 * Input coercion & validation kit (design §A).
 *
 * LLMs emit loosely-typed, frequently stringified arguments. These helpers
 * coerce those into the shapes the v3 API expects and reject bad values with a
 * *fixable* message before anything hits the wire (P1/P4), instead of letting
 * an opaque "param error" come back from the server.
 */

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function compactObject(
  object: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined && value !== null) {
      next[key] = value;
    }
  }
  return next;
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function readString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (isAbsent(value)) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  throw new ValidationError(
    `Parameter "${key}" must be a string.`,
    `Received ${typeof value}.`,
  );
}

export function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = readString(args, key);
  if (value === undefined) {
    throw new ValidationError(`Missing required parameter "${key}".`);
  }
  return value;
}

export function readNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  if (isAbsent(value)) return undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`Parameter "${key}" must be a finite number.`);
    }
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) {
      throw new ValidationError(
        `Parameter "${key}" must be a numeric value.`,
        `Received "${value}".`,
      );
    }
    return parsed;
  }
  throw new ValidationError(`Parameter "${key}" must be a number.`);
}

export function readBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key];
  if (isAbsent(value)) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  throw new ValidationError(
    `Parameter "${key}" must be a boolean.`,
    "Use true or false.",
  );
}

/**
 * Coerce to a string array. Accepts a real array, a JSON-string array
 * (`'["BTCUSDT"]'` → `["BTCUSDT"]`), a comma-separated string (`"A,B"`), or a
 * single value (`"BTCUSDT"` → `["BTCUSDT"]`).
 */
export function readStringArray(
  args: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = args[key];
  if (isAbsent(value)) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new ValidationError(
          `Parameter "${key}" looks like a JSON array but is not valid JSON.`,
          "Pass a real array or a comma-separated string.",
        );
      }
      if (!Array.isArray(parsed)) {
        throw new ValidationError(`Parameter "${key}" must be an array.`);
      }
      return parsed.map((item) => String(item));
    }
    return trimmed.includes(",")
      ? trimmed
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [trimmed];
  }
  throw new ValidationError(`Parameter "${key}" must be a string array.`);
}

/**
 * Coerce to an array of objects, parsing a JSON string if needed. Used for
 * batch payloads (e.g. batchOrder) where an LLM often passes a stringified
 * array of order objects.
 */
export function readObjectArray(
  args: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] | undefined {
  const value = args[key];
  if (isAbsent(value)) return undefined;
  let array: unknown = value;
  if (typeof value === "string") {
    try {
      array = JSON.parse(value);
    } catch {
      throw new ValidationError(
        `Parameter "${key}" must be a JSON array of objects.`,
      );
    }
  }
  if (!Array.isArray(array)) {
    throw new ValidationError(`Parameter "${key}" must be an array.`);
  }
  return array.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ValidationError(`Each entry of "${key}" must be an object.`);
    }
    return item as Record<string, unknown>;
  });
}

/** Return `value` if it is one of `allowed`, else throw a fixable error. */
export function ensureOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  label = "value",
): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new ValidationError(
    `Invalid ${label} "${value}".`,
    `Use one of: ${allowed.join(", ")}.`,
  );
}

/** Read an enum-valued argument, rejecting unknown values before the call. */
export function assertEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  options: { required?: boolean } = {},
): T | undefined {
  const value = readString(args, key);
  if (value === undefined) {
    if (options.required) {
      throw new ValidationError(
        `Missing required parameter "${key}".`,
        `Use one of: ${allowed.join(", ")}.`,
      );
    }
    return undefined;
  }
  return ensureOneOf(value, allowed, key);
}
