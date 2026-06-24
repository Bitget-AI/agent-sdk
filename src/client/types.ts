import type { RateLimitConfig } from "../utils/rate-limiter.js";

export type HttpMethod = "GET" | "POST";
export type EndpointAuth = "public" | "private";

export type QueryValue = unknown;
export type QueryParams = Record<string, QueryValue>;
export type JsonRecord = Record<string, unknown>;

export interface BitgetApiResponse<TData = unknown> {
  code: string;
  msg?: string;
  requestTime?: number;
  data?: TData;
  [key: string]: unknown;
}

export interface RequestConfig {
  method: HttpMethod;
  path: string;
  auth: EndpointAuth;
  query?: QueryParams;
  body?: JsonRecord | JsonRecord[];
  rateLimit?: RateLimitConfig;
}

export interface RequestResult<TData = unknown> {
  endpoint: string;
  requestTime: string;
  data: TData;
  raw: BitgetApiResponse<TData>;
}

/**
 * Optional observability hooks fired across a request's lifecycle (design §K).
 * Each is invoked best-effort and wrapped in a try/catch by the client, so a
 * throwing hook can never break the request itself. `attempt` is 1-based and
 * increments on every retry.
 */
export interface ClientHooks {
  onRequest?(event: {
    method: HttpMethod;
    endpoint: string;
    url: string;
    attempt: number;
  }): void;
  onResponse?(event: {
    method: HttpMethod;
    endpoint: string;
    status: number;
    code?: string;
    durationMs: number;
    attempt: number;
  }): void;
  onRetry?(event: {
    method: HttpMethod;
    endpoint: string;
    attempt: number;
    delayMs: number;
    reason: string;
    status?: number;
  }): void;
  onError?(event: {
    method: HttpMethod;
    endpoint: string;
    error: unknown;
    attempt: number;
  }): void;
}
