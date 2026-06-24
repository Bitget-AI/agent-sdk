import { signBitgetPayload } from "../utils/signature.js";
import {
  AuthenticationError,
  BitgetApiError,
  ConfigError,
  NetworkError,
  ValidationError,
} from "../utils/errors.js";
import { decodeError } from "../utils/error-catalog.js";
import {
  computeBackoffMs,
  isIdempotentRequest,
  isRetryableStatus,
  parseRetryAfter,
  sleep,
} from "../utils/retry.js";
import { RateLimiter, type RateLimitConfig } from "../utils/rate-limiter.js";
import { publicRateLimit, privateRateLimit } from "../tools/common.js";
import { getOperation, type CatalogOperation } from "../generated/catalog.js";
import type { BitgetConfig } from "../config.js";
import type {
  BitgetApiResponse,
  QueryParams,
  QueryValue,
  RequestConfig,
  RequestResult,
} from "./types.js";

function isDefined(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function stringifyQueryValue(value: QueryValue): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(",");
  }
  return String(value);
}

function buildQueryString(query?: QueryParams): string {
  if (!query) {
    return "";
  }

  const entries = Object.entries(query).filter(([, value]) => isDefined(value));
  if (entries.length === 0) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.set(key, stringifyQueryValue(value));
  }
  return params.toString();
}

export class BitgetRestClient {
  private readonly config: BitgetConfig;
  private readonly rateLimiter = new RateLimiter();

  public constructor(config: BitgetConfig) {
    this.config = config;
  }

  public async publicGet<TData = unknown>(
    path: string,
    query?: QueryParams,
    rateLimit?: RequestConfig["rateLimit"],
  ): Promise<RequestResult<TData>> {
    return this.request<TData>({
      method: "GET",
      path,
      auth: "public",
      query,
      rateLimit,
    });
  }

  public async privateGet<TData = unknown>(
    path: string,
    query?: QueryParams,
    rateLimit?: RequestConfig["rateLimit"],
  ): Promise<RequestResult<TData>> {
    return this.request<TData>({
      method: "GET",
      path,
      auth: "private",
      query,
      rateLimit,
    });
  }

  public async privatePost<TData = unknown>(
    path: string,
    body?: RequestConfig["body"],
    rateLimit?: RequestConfig["rateLimit"],
  ): Promise<RequestResult<TData>> {
    return this.request<TData>({
      method: "POST",
      path,
      auth: "private",
      body,
      rateLimit,
    });
  }

  /**
   * Invoke any catalog operation by its operationId. Splits the flat `args`
   * record into path params / query (GET) / body (POST) using the generated
   * catalog, so callers never hand-write paths. This is the single entry point
   * the generic tool layer and tests rely on.
   */
  public async callOperation<TData = unknown>(
    operationId: string,
    args: Record<string, unknown> = {},
    rateLimit?: RateLimitConfig,
  ): Promise<RequestResult<TData>> {
    const op = getOperation(operationId);
    if (!op) {
      throw new ValidationError(
        `Unknown operationId "${operationId}".`,
        "Check the generated catalog (src/generated/catalog.ts) for valid ids.",
      );
    }

    const { path, rest } = applyPathParams(op, args);
    const rl =
      rateLimit ??
      (op.auth === "public"
        ? publicRateLimit(op.path)
        : privateRateLimit(op.path));

    if (op.method === "GET") {
      return op.auth === "public"
        ? this.publicGet<TData>(path, rest, rl)
        : this.privateGet<TData>(path, rest, rl);
    }
    return this.privatePost<TData>(path, rest, rl);
  }

  private async request<TData = unknown>(
    config: RequestConfig,
  ): Promise<RequestResult<TData>> {
    const queryString = buildQueryString(config.query);
    const endpoint = queryString.length > 0 ? `${config.path}?${queryString}` : config.path;
    const url = `${this.config.baseUrl}${endpoint}`;
    const bodyJson = config.body ? JSON.stringify(config.body) : "";
    const label = `${config.method} ${config.path}`;
    const hooks = this.config.hooks;

    // Credential gate — deterministic, so it runs once before any attempt.
    if (config.auth === "private") {
      if (!this.config.hasAuth) {
        throw new ConfigError(
          "Private endpoint requires API credentials.",
          "Configure BITGET_API_KEY, BITGET_SECRET_KEY and BITGET_PASSPHRASE.",
        );
      }
      if (!this.config.apiKey || !this.config.secretKey || !this.config.passphrase) {
        throw new ConfigError(
          "Invalid private API credentials state.",
          "Ensure all BITGET credentials are set.",
        );
      }
    }

    const retry = this.config.retry;
    const maxAttempts = isIdempotentRequest(config.method, config.body)
      ? retry.maxRetries + 1
      : 1;

    let attempt = 0;
    for (;;) {
      attempt += 1;

      if (config.rateLimit) {
        await this.rateLimiter.consume(config.rateLimit);
      }

      const headers = this.buildHeaders(config, endpoint, bodyJson);
      this.emit(hooks?.onRequest, { method: config.method, endpoint: label, url, attempt });

      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: config.method,
          headers,
          body: config.method === "POST" ? bodyJson : undefined,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });
      } catch (error) {
        if (attempt < maxAttempts) {
          const delayMs = computeBackoffMs(attempt, retry);
          this.emit(hooks?.onRetry, {
            method: config.method,
            endpoint: label,
            attempt,
            delayMs,
            reason: "network-error",
          });
          await sleep(delayMs);
          continue;
        }
        const netError = new NetworkError(
          `Failed to call Bitget endpoint ${label}.`,
          label,
          error,
        );
        this.emit(hooks?.onError, { method: config.method, endpoint: label, error: netError, attempt });
        throw netError;
      }

      const durationMs = Date.now() - startedAt;

      if (isRetryableStatus(response.status, retry) && attempt < maxAttempts) {
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        const delayMs = retryAfterMs ?? computeBackoffMs(attempt, retry);
        this.emit(hooks?.onResponse, {
          method: config.method,
          endpoint: label,
          status: response.status,
          durationMs,
          attempt,
        });
        this.emit(hooks?.onRetry, {
          method: config.method,
          endpoint: label,
          attempt,
          delayMs,
          reason: `http-${response.status}`,
          status: response.status,
        });
        await response.text().catch(() => undefined); // drain to free the socket
        await sleep(delayMs);
        continue;
      }

      const rawText = await response.text();
      let parsed: BitgetApiResponse<TData> | undefined;
      let parseError: unknown;
      try {
        parsed = (rawText ? JSON.parse(rawText) : {}) as BitgetApiResponse<TData>;
      } catch (error) {
        parseError = error;
      }

      this.emit(hooks?.onResponse, {
        method: config.method,
        endpoint: label,
        status: response.status,
        code: parsed?.code,
        durationMs,
        attempt,
      });

      try {
        return this.finalize<TData>(config, label, response, rawText, parsed, parseError);
      } catch (error) {
        this.emit(hooks?.onError, { method: config.method, endpoint: label, error, attempt });
        throw error;
      }
    }
  }

  private buildHeaders(config: RequestConfig, endpoint: string, bodyJson: string): Headers {
    const headers = new Headers({
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": this.config.userAgent,
      locale: "en-US",
    });

    // Paper trading is an account/trade concept: the Bitget demo environment
    // only hosts private (account-scoped) endpoints. Public market data must
    // NOT carry this header — several public endpoints (e.g. proof-of-reserves,
    // index-components) return 404 ("Request URL NOT FOUND") under paptrading:1.
    if (this.config.paperTrading && config.auth === "private") {
      headers.set("paptrading", "1");
    }

    if (config.auth === "private") {
      // Credential presence is validated once before the attempt loop.
      const timestamp = Date.now().toString();
      const payload = `${timestamp}${config.method.toUpperCase()}${endpoint}${bodyJson}`;
      const signature = signBitgetPayload(payload, this.config.secretKey as string);
      headers.set("ACCESS-KEY", this.config.apiKey as string);
      headers.set("ACCESS-SIGN", signature);
      headers.set("ACCESS-PASSPHRASE", this.config.passphrase as string);
      headers.set("ACCESS-TIMESTAMP", timestamp);
    }

    return headers;
  }

  private finalize<TData>(
    config: RequestConfig,
    label: string,
    response: Response,
    rawText: string,
    parsed: BitgetApiResponse<TData> | undefined,
    parseError: unknown,
  ): RequestResult<TData> {
    if (parseError !== undefined || parsed === undefined) {
      if (!response.ok) {
        const messagePreview = rawText.slice(0, 160).replace(/\s+/g, " ").trim();
        throw new BitgetApiError(
          `HTTP ${response.status} from Bitget: ${messagePreview || "Non-JSON response body"}`,
          {
            code: String(response.status),
            endpoint: label,
            suggestion: "Verify endpoint path and request parameters.",
          },
        );
      }
      throw new NetworkError(
        `Bitget returned non-JSON response for ${label}.`,
        label,
        parseError,
      );
    }

    if (!response.ok) {
      throw new BitgetApiError(
        `HTTP ${response.status} from Bitget: ${parsed.msg ?? "Unknown error"}`,
        {
          code: String(response.status),
          endpoint: label,
          suggestion: "Retry later or verify endpoint parameters.",
        },
      );
    }

    const responseCode = parsed.code;
    if (responseCode && responseCode !== "00000") {
      const message = parsed.msg ?? "Bitget API request failed.";
      if (
        responseCode === "40017" ||
        responseCode === "40018" ||
        responseCode === "40036"
      ) {
        throw new AuthenticationError(
          message,
          "Check API key, secret, passphrase and permissions.",
          label,
        );
      }

      throw new BitgetApiError(message, {
        code: responseCode,
        endpoint: label,
        suggestion: decodeError(responseCode)?.suggestion,
      });
    }

    return {
      endpoint: label,
      requestTime: new Date().toISOString(),
      data: (parsed.data ?? null) as TData,
      raw: parsed,
    };
  }

  private emit<E>(hook: ((event: E) => void) | undefined, event: E): void {
    if (!hook) {
      return;
    }
    try {
      hook(event);
    } catch {
      // Observability hooks are best-effort and must never break the request.
    }
  }
}

function applyPathParams(
  op: CatalogOperation,
  args: Record<string, unknown>,
): { path: string; rest: Record<string, unknown> } {
  let path = op.path;
  const rest: Record<string, unknown> = { ...args };
  for (const name of op.pathParams) {
    const value = args[name];
    if (value === undefined || value === null || value === "") {
      throw new ValidationError(
        `Missing required path parameter "${name}" for ${op.operationId}.`,
      );
    }
    path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    delete rest[name];
  }
  return { path, rest };
}
