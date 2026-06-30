import {
  DEFAULT_MODULES,
  HIDDEN_MODULES,
  MODULES,
  SERVER_NAME,
  SERVER_VERSION,
  type ModuleId,
} from "./constants.js";
import { ConfigError } from "./utils/errors.js";
import { DEFAULT_RETRY, type RetryConfig } from "./utils/retry.js";
import type { ClientHooks } from "./client/types.js";

/**
 * Tool-surface mode (design redesign §L2).
 *   - "intent": the curated capability surface — intent tools + `raw` + `discover`.
 *   - "full":   ALSO emit the 1:1 generated tool per catalog operation, exposing
 *               the underlying API endpoints individually (debug / power use).
 */
export type Surface = "intent" | "full";

export interface CliOptions {
  modules?: string;
  readOnly?: boolean;
  paperTrading?: boolean;
  surface?: string;
  /** Programmatic credential overrides — take precedence over BITGET_* env vars. */
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  /** Override the API base URL (else BITGET_API_BASE_URL, else production). */
  baseUrl?: string;
  /** Override the per-request timeout in ms (else BITGET_TIMEOUT_MS, else 15000). */
  timeoutMs?: number;
  /** Override the User-Agent header. */
  userAgent?: string;
  /** Partial retry-policy override merged over the defaults. */
  retry?: Partial<RetryConfig>;
  /** Observability lifecycle hooks. */
  hooks?: ClientHooks;
}

export interface BitgetConfig {
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  hasAuth: boolean;
  baseUrl: string;
  timeoutMs: number;
  userAgent: string;
  modules: ModuleId[];
  readOnly: boolean;
  paperTrading: boolean;
  surface: Surface;
  retry: RetryConfig;
  hooks?: ClientHooks;
}

function parseModuleList(rawModules?: string): ModuleId[] {
  if (!rawModules || rawModules.trim().length === 0) {
    return [...DEFAULT_MODULES];
  }

  const trimmed = rawModules.trim().toLowerCase();
  if (trimmed === "all") {
    // "all" means all generally-available (to-C) modules. The to-B modules in
    // HIDDEN_MODULES are excluded here and must be named explicitly to appear.
    return MODULES.filter((moduleId) => !HIDDEN_MODULES.includes(moduleId));
  }

  const requested = trimmed
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (requested.length === 0) {
    return [...DEFAULT_MODULES];
  }

  const deduped = new Set<ModuleId>();
  for (const moduleId of requested) {
    if (!MODULES.includes(moduleId as ModuleId)) {
      throw new ConfigError(
        `Unknown module "${moduleId}".`,
        `Use one of: ${MODULES.join(", ")} or "all".`,
      );
    }
    deduped.add(moduleId as ModuleId);
  }

  return Array.from(deduped);
}

/**
 * Resolve the tool surface. Defaults to "intent" — the curated capability
 * surface (the curated verbs + `raw` + `discover`), whose `fronts` reach every
 * catalog operation. Pass "full" to ALSO emit the 1:1 generated tool per
 * operation (debug / power use). Note: the to-B verbs in HIDDEN_MODULES
 * (broker, inst_loan) are excluded from `modules: "all"` and must be named
 * explicitly to appear in either surface.
 */
function parseSurface(raw?: string): Surface {
  if (raw === undefined || raw.trim().length === 0) {
    return "intent";
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "intent" || trimmed === "full") {
    return trimmed;
  }
  throw new ConfigError(
    `Unknown surface "${raw}".`,
    'Use "intent" (curated) or "full" (also expose the 1:1 generated tier).',
  );
}

function loadTimeoutMs(override?: number): number {
  if (override !== undefined) {
    if (!Number.isFinite(override) || override <= 0) {
      throw new ConfigError(
        `Invalid timeoutMs value "${override}".`,
        "Pass timeoutMs as a positive number of milliseconds.",
      );
    }
    return Math.floor(override);
  }

  const raw = process.env.BITGET_TIMEOUT_MS;
  if (!raw) {
    return 15_000;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(
      `Invalid BITGET_TIMEOUT_MS value "${raw}".`,
      "Set BITGET_TIMEOUT_MS as a positive integer in milliseconds.",
    );
  }

  return Math.floor(parsed);
}

function loadBaseUrl(override?: string): string {
  const baseUrl =
    override?.trim() || process.env.BITGET_API_BASE_URL?.trim() || "https://api.bitget.com";
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new ConfigError(
      `Invalid base URL "${baseUrl}".`,
      "The base URL must start with http:// or https://",
    );
  }
  return baseUrl.replace(/\/+$/, "");
}

function loadRetry(override?: Partial<RetryConfig>): RetryConfig {
  let maxRetries = DEFAULT_RETRY.maxRetries;
  const envMax = process.env.BITGET_MAX_RETRIES;
  if (envMax !== undefined && envMax.trim().length > 0) {
    const parsed = Number(envMax);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new ConfigError(
        `Invalid BITGET_MAX_RETRIES value "${envMax}".`,
        "Set BITGET_MAX_RETRIES as a non-negative integer.",
      );
    }
    maxRetries = parsed;
  }

  const merged: RetryConfig = {
    ...DEFAULT_RETRY,
    maxRetries,
    ...override,
    // never share the default array reference
    retryableStatuses: [...(override?.retryableStatuses ?? DEFAULT_RETRY.retryableStatuses)],
  };

  if (!Number.isInteger(merged.maxRetries) || merged.maxRetries < 0) {
    throw new ConfigError(
      `Invalid retry.maxRetries "${merged.maxRetries}".`,
      "maxRetries must be a non-negative integer.",
    );
  }
  if (merged.baseDelayMs < 0 || merged.maxDelayMs < 0) {
    throw new ConfigError(
      "Invalid retry backoff configuration.",
      "baseDelayMs and maxDelayMs must be non-negative.",
    );
  }
  return merged;
}

export function loadConfig(cli: CliOptions = {}): BitgetConfig {
  const apiKey = cli.apiKey?.trim() || process.env.BITGET_API_KEY?.trim();
  const secretKey = cli.secretKey?.trim() || process.env.BITGET_SECRET_KEY?.trim();
  const passphrase = cli.passphrase?.trim() || process.env.BITGET_PASSPHRASE?.trim();

  const hasAuth = Boolean(apiKey && secretKey && passphrase);
  const partialAuth =
    Boolean(apiKey) || Boolean(secretKey) || Boolean(passphrase);

  if (partialAuth && !hasAuth) {
    throw new ConfigError(
      "Partial API credentials detected.",
      "Provide apiKey, secretKey and passphrase together (via options or BITGET_* env vars).",
    );
  }

  if (cli.paperTrading && cli.readOnly) {
    throw new ConfigError(
      "paperTrading and readOnly are mutually exclusive.",
      "Use --paper-trading for simulated writes, or --read-only to block all writes — not both.",
    );
  }

  return {
    apiKey,
    secretKey,
    passphrase,
    hasAuth,
    baseUrl: loadBaseUrl(cli.baseUrl),
    timeoutMs: loadTimeoutMs(cli.timeoutMs),
    userAgent: cli.userAgent?.trim() || `${SERVER_NAME}/${SERVER_VERSION} (node)`,
    modules: parseModuleList(cli.modules),
    readOnly: cli.readOnly ?? false,
    paperTrading: cli.paperTrading ?? false,
    surface: parseSurface(cli.surface),
    retry: loadRetry(cli.retry),
    hooks: cli.hooks,
  };
}
