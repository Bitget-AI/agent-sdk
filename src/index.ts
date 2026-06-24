/**
 * @bitget-ai/bitget-agent-sdk — public API
 *
 * The Bitget Agent Hub foundation SDK, targeting the Unified Trading Account
 * (UTA / v3) REST API. The entire surface is generated from `openapi.yaml`:
 * a build-time catalog (src/generated/catalog.ts) drives the REST client,
 * the AI-callable tool layer, and the built-in mock server, so a spec change
 * propagates everywhere via `pnpm run gen` with zero drift.
 *
 * The testing harness (mock server) is available via the
 * `@bitget-ai/bitget-agent-sdk/testing` subpath.
 *
 * @packageDocumentation
 */

// ── Client & tooling primitives ─────────────────────────────────────────
export { BitgetRestClient } from "./client/rest-client.js";
export { buildTools, toToolSpec } from "./tools/build.js";
export { buildRawTool, RAW_TOOL_NAME } from "./tools/raw.js";
export { riskLevelOf, HIGH_RISK_OPERATIONS } from "./tools/risk.js";
export { loadConfig } from "./config.js";

// ── Write-safety middleware (design §H / P3) ────────────────────────────
export { executeWithSafety, splitControls } from "./tools/safety.js";
export type { SafetyControls } from "./tools/safety.js";

// ── L3 consumption contract: safeInvoke + MCP adapter (design §K / P0-3) ──
export { safeInvoke, toMcpTool, MCP_TOOL_NAME_PATTERN } from "./tools/consume.js";
export type { SafeResult, ToolResultOk, McpToolDescriptor } from "./tools/consume.js";

// ── Response normalization & token economy (design §E / P2) ─────────────
export { applyView, trimNulls, projectFields } from "./tools/normalize.js";
export type { ResultView, ViewOptions } from "./tools/normalize.js";

// ── Cursor pagination / fetch-all (design §F) ───────────────────────────
export { fetchAllPages } from "./tools/paginate.js";
export type { PaginateOptions, PaginateResult } from "./tools/paginate.js";

// ── Curated composite verb tier (design §C / P4) ────────────────────────
export {
  buildCompositeTools,
  COMPOSITE_TOOL_NAMES,
} from "./tools/composites/index.js";

// ── Progressive discovery + domain taxonomy (redesign §L2 / guide §5.1) ──
export { buildDiscoverTool, DISCOVER_TOOL_NAME } from "./tools/discover.js";
export { DOMAINS, META_DOMAIN, MODULE_TO_DOMAIN, domainOrder } from "./tools/domains.js";
export type { Domain } from "./tools/domains.js";

// ── Input coercion & validation kit (design §A) ─────────────────────────
export {
  asRecord,
  compactObject,
  requireString,
  readString,
  readNumber,
  readBoolean,
  readStringArray,
  readObjectArray,
  ensureOneOf,
  assertEnum,
} from "./tools/helpers.js";

// ── Curated input-schema field hints (design §A / P1-9) ─────────────────
export { FIELD_SCHEMAS, fieldSchema, enrichProperties } from "./tools/field-schemas.js";
export type { FieldSchema } from "./tools/field-schemas.js";

// ── Generated operation catalog ─────────────────────────────────────────
export {
  CATALOG,
  CATALOG_SPEC_VERSION,
  CATALOG_OPERATION_COUNT,
  getOperation,
} from "./generated/catalog.js";
export type { CatalogOperation, CatalogParam } from "./generated/catalog.js";

// ── Public types ────────────────────────────────────────────────────────
export type { BitgetConfig, CliOptions, Surface } from "./config.js";
export type {
  ToolSpec,
  ToolContext,
  ToolResult,
  JsonSchema,
  RiskLevel,
} from "./tools/types.js";
export type { ModuleId } from "./constants.js";
export type {
  RequestResult,
  BitgetApiResponse,
  HttpMethod,
  EndpointAuth,
  ClientHooks,
} from "./client/types.js";

// ── Transport retry policy (design §G) ──────────────────────────────────
export {
  DEFAULT_RETRY,
  MAX_RETRY_AFTER_MS,
  isRetryableStatus,
  isIdempotentRequest,
  computeBackoffMs,
  parseRetryAfter,
} from "./utils/retry.js";
export type { RetryConfig } from "./utils/retry.js";

// ── Constants & metadata ────────────────────────────────────────────────
export {
  SERVER_NAME,
  SERVER_VERSION,
  API_VARIANT,
  MODULES,
  DEFAULT_MODULES,
  HIDDEN_MODULES,
  TAG_TO_MODULE,
} from "./constants.js";

// ── Error types ─────────────────────────────────────────────────────────
export {
  BitgetMcpError,
  BitgetApiError,
  ConfigError,
  ValidationError,
  RateLimitError,
  AuthenticationError,
  NetworkError,
  toToolErrorPayload,
} from "./utils/errors.js";
export type { ErrorType, ToolErrorPayload } from "./utils/errors.js";

// ── Semantic error catalog (design §B) ──────────────────────────────────
export {
  ERROR_CATALOG,
  decodeError,
  classify as classifyError,
} from "./utils/error-catalog.js";
export type { ErrorCategory, ErrorDecode } from "./utils/error-catalog.js";
