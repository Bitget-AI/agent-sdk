/**
 * bitget-agent-sdk — public API
 *
 * The Bitget Agent Hub Foundation SDK. Exposes the full Bitget REST surface
 * as 56+ AI-callable tools, plus configuration, error types, and a built-in
 * mock server (via the `bitget-agent-sdk/testing` subpath).
 *
 * @packageDocumentation
 */

// ── Client & tooling primitives ─────────────────────────────────────────
export { BitgetRestClient } from "./client/rest-client.js";
export { buildTools } from "./tools/index.js";
export { loadConfig } from "./config.js";

// ── Public types ────────────────────────────────────────────────────────
export type { BitgetConfig, CliOptions } from "./config.js";
export type { ToolSpec, ToolContext } from "./tools/types.js";
export type { ModuleId } from "./constants.js";

// ── Constants & metadata ────────────────────────────────────────────────
export {
  SERVER_NAME,
  SERVER_VERSION,
  MODULES,
  DEFAULT_MODULES,
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

// ── Surface bootstrap helpers ───────────────────────────────────────────
// These are intended for surface implementations (CLI, MCP server, etc.) that
// need to detect runtime capabilities before exposing tools to end users.
// Application code that calls a tool's `handler` directly does not normally
// need these.
export {
  getEarnCapabilityStatus,
  warmupEarnCapability,
} from "./tools/earn.js";
