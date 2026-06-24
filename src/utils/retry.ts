/**
 * Transport-level retry policy (design §G).
 *
 * Retries are confined to *transient* transport failures — network errors and
 * the retryable HTTP statuses (429 + 5xx). Application-level Bitget errors come
 * back as HTTP 200 with a non-`00000` code and are deterministic, so they are
 * never retried here. To stay safe under at-least-once delivery, only
 * idempotent requests are retried: every GET, and POSTs that carry a
 * `clientOid` (Bitget de-duplicates writes by client order id).
 */

export interface RetryConfig {
  /** Extra attempts after the first. 0 disables retries. */
  maxRetries: number;
  /** Backoff base in ms; the delay grows exponentially from here. */
  baseDelayMs: number;
  /** Upper bound for a single backoff delay in ms. */
  maxDelayMs: number;
  /** HTTP statuses that trigger a retry. */
  retryableStatuses: number[];
}

export const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/** Hard ceiling for a server-provided `Retry-After`, so a hostile/huge value cannot stall us. */
export const MAX_RETRY_AFTER_MS = 30_000;

export function isRetryableStatus(status: number, config: RetryConfig): boolean {
  return config.retryableStatuses.includes(status);
}

/**
 * An idempotent request can be safely re-sent. GETs always qualify; a POST only
 * qualifies when it carries a top-level `clientOid` (the write's idempotency
 * key). Batch bodies (no top-level clientOid) are intentionally treated as
 * non-idempotent.
 */
export function isIdempotentRequest(method: string, body?: unknown): boolean {
  if (method.toUpperCase() === "GET") {
    return true;
  }
  if (method.toUpperCase() !== "POST") {
    return false;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const clientOid = (body as Record<string, unknown>).clientOid;
  return typeof clientOid === "string" && clientOid.length > 0;
}

/**
 * Exponential backoff with additive jitter (≤ 25%). A `baseDelayMs` of 0
 * yields 0 — handy for fast tests.
 */
export function computeBackoffMs(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(config.maxDelayMs, exponential);
  if (capped <= 0) {
    return 0;
  }
  const jitter = Math.random() * (capped * 0.25);
  return Math.round(capped + jitter);
}

/**
 * Parse an HTTP `Retry-After` header. Supports both delta-seconds (an integer)
 * and an HTTP-date. Returns the wait in ms, clamped to [0, MAX_RETRY_AFTER_MS],
 * or `undefined` when the header is absent/unparseable.
 */
export function parseRetryAfter(value: string | null, nowMs: number = Date.now()): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(MAX_RETRY_AFTER_MS, Number(trimmed) * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, dateMs - nowMs));
  }
  return undefined;
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
