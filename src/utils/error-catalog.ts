import type { ErrorType } from "./errors.js";

/**
 * Semantic error catalog (design §B).
 *
 * Turns an opaque Bitget error code into a machine-readable recovery
 * instruction (P1). An LLM branches on `category` + `retryable`:
 *   auth/param  → fix the request and resend
 *   balance/risk → surface to the user (cannot self-heal)
 *   rate/network → back off and retry
 *   region       → fall back to another surface
 */

export type ErrorCategory =
  | "auth"
  | "param"
  | "balance"
  | "risk"
  | "rate"
  | "region"
  | "network"
  | "config"
  | "unknown";

export interface ErrorDecode {
  category: ErrorCategory;
  /** What the code means, in plain language. */
  meaning: string;
  /** The concrete next step the caller should take. */
  suggestion: string;
  /** True when the identical call may succeed after a short backoff. */
  retryable: boolean;
}

/**
 * Curated Bitget UTA v3 error decodes — grounded entirely in Bitget's published
 * REST error-code table (no invented codes). The set is deliberately a
 * high-confidence subset, not the full ~150-row table: every entry here has an
 * UNAMBIGUOUS category and a genuinely useful `retryable` signal. Hyper-specific
 * or niche-module codes are intentionally omitted and fall through to the coarse
 * type-based classification in {@link classify}.
 *
 * Two transport notes:
 *   - HTTP transport failures arrive as `BitgetApiError` whose `code` is the
 *     stringified HTTP status (rest-client `finalize`), so "429"/"5xx" live here
 *     too — this is what lets a throttled or server-error response classify as
 *     rate/network + retryable instead of falling through to `unknown`.
 *   - 40017/40018/40036 are additionally special-cased by the client into
 *     `AuthenticationError` (thrown WITHOUT a code), so at runtime they classify
 *     as `auth` via the type fallback; their entries here keep `decodeError`
 *     consistent for any direct lookup. 40017's "parameter verification failed"
 *     is the *signature*-parameter check, hence `auth` (kept aligned with the
 *     client), not the generic request-param error that 40034 covers.
 */
export const ERROR_CATALOG: Readonly<Record<string, ErrorDecode>> = {
  // ── HTTP transport status (code = stringified HTTP status; retry-after backoff) ──
  "429": {
    category: "rate",
    meaning: "Request rate limit exceeded (HTTP 429).",
    suggestion: "Back off and retry after a short delay.",
    retryable: true,
  },
  "500": {
    category: "network",
    meaning: "Bitget server error (HTTP 500).",
    suggestion: "Transient server-side error — retry after a short backoff.",
    retryable: true,
  },
  "502": {
    category: "network",
    meaning: "Bad gateway (HTTP 502).",
    suggestion: "Transient upstream error — retry after a short backoff.",
    retryable: true,
  },
  "503": {
    category: "network",
    meaning: "Service unavailable (HTTP 503).",
    suggestion: "Bitget is temporarily unavailable — retry after a short backoff.",
    retryable: true,
  },
  "504": {
    category: "network",
    meaning: "Gateway timeout (HTTP 504).",
    suggestion: "Request timed out upstream — retry after a short backoff.",
    retryable: true,
  },

  // ── auth / credentials / signature ──
  "40001": {
    category: "auth",
    meaning: "ACCESS_KEY is empty.",
    suggestion: "Set the BITGET_API_KEY credential.",
    retryable: false,
  },
  "40002": {
    category: "auth",
    meaning: "SECRET_KEY is empty.",
    suggestion: "Set the BITGET_SECRET_KEY credential.",
    retryable: false,
  },
  "40003": {
    category: "auth",
    meaning: "Signature is empty.",
    suggestion: "Ensure the request is signed before sending.",
    retryable: false,
  },
  "40006": {
    category: "auth",
    meaning: "Invalid ACCESS_KEY.",
    suggestion: "Verify the API key is correct and still active.",
    retryable: false,
  },
  "40008": {
    category: "auth",
    meaning: "Request timestamp expired.",
    suggestion:
      "Sync the local clock — the signed timestamp is outside Bitget's accepted window.",
    retryable: false,
  },
  "40009": {
    category: "auth",
    meaning: "Signature verification failed.",
    suggestion: "Re-check the signing algorithm, secret key and the signed payload.",
    retryable: false,
  },
  "40017": {
    category: "auth",
    meaning: "Signature parameter verification failed.",
    suggestion:
      "Check API key/secret/passphrase and that the signed payload matches the request.",
    retryable: false,
  },
  "40018": {
    category: "auth",
    meaning: "API key permission or IP restriction error.",
    suggestion:
      "Verify the API key's permissions and that the calling IP is whitelisted.",
    retryable: false,
  },
  "40036": {
    category: "auth",
    meaning: "API key is invalid or has been revoked.",
    suggestion: "Regenerate the API key and update the BITGET_* credentials.",
    retryable: false,
  },
  "40042": {
    category: "auth",
    meaning: "Account is an institutional sub-account with restricted business scope.",
    suggestion:
      "This API key's account cannot call this endpoint — use a main or differently-scoped account.",
    retryable: false,
  },
  "25620": {
    category: "auth",
    meaning: "No access permission for this resource.",
    suggestion:
      "The API key lacks permission for this endpoint; enable it or use a key that has it.",
    retryable: false,
  },

  // ── rate / throttle ──
  "25004": {
    category: "rate",
    meaning: "Operations too frequent.",
    suggestion: "You are being throttled — slow down and retry after a short delay.",
    retryable: true,
  },

  // ── transient / system (retry after backoff) ──
  "25000": {
    category: "network",
    meaning: "System error.",
    suggestion: "Transient server-side error — retry after a short backoff.",
    retryable: true,
  },
  "25001": {
    category: "network",
    meaning: "Operation timed out.",
    suggestion: "Transient timeout — retry after a short backoff.",
    retryable: true,
  },
  "25003": {
    category: "network",
    meaning: "Concurrent operation conflict.",
    suggestion: "A concurrent request conflicted — retry after a short delay.",
    retryable: true,
  },

  // ── parameter / request shape (fix the request, then resend) ──
  "40034": {
    category: "param",
    meaning: "A request parameter is invalid or missing.",
    suggestion:
      "Re-check parameter names and values against the operation schema, then resend.",
    retryable: false,
  },
  "25200": {
    category: "param",
    meaning: "Parameter validation failed.",
    suggestion: "Re-check the request parameters against the operation schema.",
    retryable: false,
  },
  "25204": {
    category: "param",
    meaning: "Order not found.",
    suggestion:
      "Verify the orderId/clientOid — the order may not exist or may already be closed.",
    retryable: false,
  },
  "25207": {
    category: "param",
    meaning: "Order quantity below the minimum.",
    suggestion:
      "Increase the order quantity to meet the symbol's minimum (e.g. the min-notional).",
    retryable: false,
  },
  "25212": {
    category: "param",
    meaning: "Duplicate clientOid.",
    suggestion: "Generate a fresh clientOid (idempotency key) per order.",
    retryable: false,
  },
  "25236": {
    category: "param",
    meaning: "Incorrect position open type.",
    suggestion:
      "Check posSide/reduceOnly match the account's position mode (one-way vs hedge).",
    retryable: false,
  },
  "25244": {
    category: "param",
    meaning: "Price must be a multiple of the tick size.",
    suggestion: "Round the price to the symbol's price step.",
    retryable: false,
  },

  // ── balance / margin (cannot self-heal; surface to the user) ──
  "25202": {
    category: "balance",
    meaning: "Insufficient balance.",
    suggestion: "Fund the trading (unified) account or reduce the order size.",
    retryable: false,
  },
  "25203": {
    category: "balance",
    meaning: "Insufficient margin.",
    suggestion: "Add margin, lower leverage, or reduce the order size.",
    retryable: false,
  },

  // ── account risk state (cannot trade right now) ──
  "25008": {
    category: "risk",
    meaning: "Account is in liquidation.",
    suggestion: "Cannot trade while the account is being liquidated; resolve risk first.",
    retryable: false,
  },
  "25012": {
    category: "risk",
    meaning: "Account is at risk and temporarily cannot trade.",
    suggestion: "Reduce risk (add margin / close exposure) before trading.",
    retryable: false,
  },
  "95001": {
    category: "risk",
    meaning: "User is currently being liquidated.",
    suggestion: "Wait until liquidation completes before retrying.",
    retryable: false,
  },

  // ── account configuration / mode ──
  "25245": {
    category: "config",
    meaning: "Account is not in unified (UTA) mode.",
    suggestion: "This SDK targets UTA v3 — switch the account to unified mode.",
    retryable: false,
  },
  "25009": {
    category: "config",
    meaning: "Unsupported account-mode switch.",
    suggestion: "The requested account-mode switch is not allowed in the current state.",
    retryable: false,
  },
  "25010": {
    category: "config",
    meaning: "Unsupported position-mode switch.",
    suggestion: "The requested position-mode switch is not allowed in the current state.",
    retryable: false,
  },
  "25110": {
    category: "config",
    meaning: "This coin cannot be transferred into the unified account.",
    suggestion: "Use a supported coin, or move funds via the web UI.",
    retryable: false,
  },
};

const TYPE_TO_CATEGORY: Record<ErrorType, ErrorCategory> = {
  ConfigError: "config",
  AuthenticationError: "auth",
  RateLimitError: "rate",
  ValidationError: "param",
  BitgetApiError: "unknown",
  NetworkError: "network",
  InternalError: "unknown",
};

const RETRYABLE_TYPES: ReadonlySet<ErrorType> = new Set<ErrorType>([
  "RateLimitError",
  "NetworkError",
]);

/** Look up a confirmed business code. Returns undefined for unknown codes. */
export function decodeError(code: string | undefined): ErrorDecode | undefined {
  if (!code) return undefined;
  return ERROR_CATALOG[code];
}

/**
 * Classify any error into `{ category, retryable }`, preferring a confirmed
 * code decode and falling back to the error type. Pure — it takes primitives
 * so it never imports the error classes (keeps this module dependency-free and
 * avoids a runtime import cycle with errors.ts).
 */
export function classify(
  type: ErrorType,
  code?: string,
): { category: ErrorCategory; retryable: boolean } {
  const decoded = decodeError(code);
  if (decoded) {
    return { category: decoded.category, retryable: decoded.retryable };
  }
  return {
    category: TYPE_TO_CATEGORY[type] ?? "unknown",
    retryable: RETRYABLE_TYPES.has(type),
  };
}
