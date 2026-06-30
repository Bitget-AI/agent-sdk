import { randomUUID } from "node:crypto";
import { assertEnum, readBoolean, requireString } from "../helpers.js";
import { enrichProperties } from "../field-schemas.js";
import { executeWithSafety } from "../safety.js";
import type { JsonSchema, ToolResult, ToolSpec } from "../types.js";
import {
  VIEW_SCHEMA_PROPS,
  callRead,
  composeActionDoc,
  forwardArgs,
  readViewOptions,
  requireOperation,
} from "./shared.js";

export const TRANSFER_DIRECTIONS = [
  "internal",
  "mainToSub",
  "subToMain",
] as const;

const DIRECTION_TO_OPERATION: Record<
  (typeof TRANSFER_DIRECTIONS)[number],
  string
> = {
  internal: "transfer",
  mainToSub: "mainSubAccountTransfer",
  subToMain: "subMainAccountTransfer",
};

/** One-line, agent-facing description per transfer direction; `composeActionDoc`
 *  appends the `(needs: …)` required-param hint from the catalog. */
const TRANSFER_ACTION_DOCS: Record<
  (typeof TRANSFER_DIRECTIONS)[number],
  string
> = {
  internal: "UTA↔classic, same user",
  mainToSub: "main → sub-account",
  subToMain: "sub → main account",
};

function transferSchema(): JsonSchema {
  return {
    type: "object",
    properties: enrichProperties({
      action: {
        type: "string",
        enum: [...TRANSFER_DIRECTIONS],
        description: `What to do — ${composeActionDoc(
          TRANSFER_DIRECTIONS.map((name) => ({
            name,
            operationId: DIRECTION_TO_OPERATION[name],
            description: TRANSFER_ACTION_DOCS[name],
          })),
        )}. preflight reports max transferable without moving funds.`,
      },
      coin: { type: "string", description: "Coin to move, e.g. USDT." },
      amount: { type: "string", description: "Amount to transfer." },
      fromType: { type: "string", description: "Source account type." },
      toType: { type: "string", description: "Destination account type." },
      fromUserId: { type: "string", description: "Source uid (mainToSub)." },
      toUserId: { type: "string", description: "Destination uid (mainToSub)." },
      symbol: { type: "string", description: "Symbol (internal isolated-margin transfers)." },
      clientOid: {
        type: "string",
        description:
          "Idempotency key. Auto-generated for sub-account transfers when omitted (P7).",
      },
      preflight: {
        type: "boolean",
        description:
          "If true, return the max transferable amount for `coin` WITHOUT transferring.",
      },
      dryRun: {
        type: "boolean",
        description: "Preview the transfer without sending it.",
      },
      ...VIEW_SCHEMA_PROPS,
    }),
    required: ["action"],
    additionalProperties: true,
  };
}

/**
 * `transfer` — move funds by intent (design §C).
 *
 * Routes to the right transfer endpoint by `action`, injects a `clientOid`
 * for sub-account transfers (idempotency, P7), and offers a read-only
 * `preflight` that reports the max transferable amount before committing. The
 * actual transfer flows through the shared safety gate (dryRun / readOnly).
 */
export function buildTransferTool(): ToolSpec {
  return {
    // NB: named `transfer_funds`, not `transfer`, because `transfer` is already
    // a catalog operationId — the 1:1 generated tier owns that name (zero-drift).
    name: "transfer_funds",
    module: "core",
    domain: "funds",
    fronts: [
      "transfer",
      "mainSubAccountTransfer",
      "subMainAccountTransfer",
      "getMaxTransferable",
    ],
    // Keyed by `action` — the same key discovers a transfer's contract
    // (discover({ tool, action })) and executes it, with no key translation.
    actions: DIRECTION_TO_OPERATION,
    method: "POST",
    path: "(composite)",
    auth: "private",
    isWrite: false,
    riskLevel: "write",
    description:
      "[VERB] Move funds by intent: action internal | mainToSub | subToMain. preflight reports max transferable without moving anything; transfers honor dryRun/readOnly.",
    inputSchema: transferSchema(),
    handler: async (args, context): Promise<ToolResult> => {
      const action = assertEnum(args, "action", TRANSFER_DIRECTIONS, {
        required: true,
      })!;

      if (readBoolean(args, "preflight") === true) {
        const coin = requireString(args, "coin");
        return callRead(
          context,
          "getMaxTransferable",
          { coin },
          readViewOptions(args),
        );
      }

      const operationId = DIRECTION_TO_OPERATION[action];
      const writeArgs = forwardArgs(args);
      if (action !== "internal" && !writeArgs.clientOid) {
        writeArgs.clientOid = randomUUID();
      }
      return executeWithSafety(
        requireOperation(operationId),
        writeArgs,
        context,
      );
    },
  };
}
