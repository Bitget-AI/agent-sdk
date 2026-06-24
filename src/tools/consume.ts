/**
 * L3 consumption contract (design §K / P0-3).
 *
 * Everything below the tool layer (the MCP server, the CLI, a Claude Skill)
 * consumes the SAME `ToolSpec[]` that `buildTools` produces. This module pins
 * the two things every such consumer needs and that must not drift:
 *
 *   1. `safeInvoke` — the runtime contract. It runs a tool's handler and ALWAYS
 *      resolves: a success becomes `{ ok: true, ...ToolResult }`, any thrown
 *      error becomes the structured `{ ok: false, error }` recovery envelope.
 *      A consumer can therefore serialize the result straight to the wire
 *      without its own try/catch, and an LLM always sees a branchable shape.
 *
 *   2. `toMcpTool` — the reference wire adapter. A `ToolSpec` already carries an
 *      MCP-shaped `name` / `description` / `inputSchema`, so the Model Context
 *      Protocol mapping is a projection, not a transform. The CLI and Skill
 *      mappings are documented in docs/L3-CONSUMPTION-CONTRACT.md and reuse the
 *      same three fields.
 *
 * Keeping both here (rather than in a downstream package) means the contract is
 * versioned and tested alongside the specs it describes.
 */

import { toToolErrorPayload, type ToolErrorPayload } from "../utils/errors.js";
import type { JsonSchema, ToolContext, ToolResult, ToolSpec } from "./types.js";

/** MCP tool names must match this; every tool name in the SDK already does. */
export const MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** A successful tool result, tagged for the discriminated `SafeResult` union. */
export interface ToolResultOk extends ToolResult {
  ok: true;
}

/**
 * The result of `safeInvoke`: either a tagged success or the structured error
 * envelope. Branch on `.ok`. This never represents a thrown exception — by the
 * time you hold a `SafeResult`, the call has already been made safe.
 */
export type SafeResult = ToolResultOk | ToolErrorPayload;

/** Stable endpoint label for error attribution when a handler throws early. */
function endpointLabel(spec: ToolSpec): string {
  return spec.path === "(composite)"
    ? `(composite) ${spec.name}`
    : `${spec.method} ${spec.path}`;
}

/**
 * Invoke a tool's handler without ever throwing.
 *
 * On success returns `{ ok: true, ...result }`; on any error returns the
 * `toToolErrorPayload` envelope (`{ ok: false, error, timestamp }`). Note that
 * protocol responses that are *not* errors — a dry-run preview or a
 * `{ confirmationRequired: true }` gate — flow through as `ok: true`, because
 * the handler returned them rather than throwing.
 */
export async function safeInvoke(
  spec: ToolSpec,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<SafeResult> {
  try {
    const result = await spec.handler(args ?? {}, context);
    return { ok: true, ...result };
  } catch (error) {
    return toToolErrorPayload(error, endpointLabel(spec));
  }
}

/** The minimal Model Context Protocol tool descriptor (name/description/schema). */
export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/**
 * Project a `ToolSpec` onto the MCP tool descriptor. The handler is intentionally
 * dropped: an MCP server advertises the descriptor, then routes `tools/call`
 * back through `safeInvoke(spec, args, ctx)` using the spec it kept by name.
 */
export function toMcpTool(spec: ToolSpec): McpToolDescriptor {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
  };
}
