import { ValidationError } from "../../utils/errors.js";
import { assertEnum, readString } from "../helpers.js";
import { mergeProjected, projectUnion } from "../param-schema.js";
import { executeWithSafety } from "../safety.js";
import type { JsonSchema, ToolResult, ToolSpec } from "../types.js";
import {
  VIEW_SCHEMA_PROPS,
  callRead,
  composeActionDoc,
  forwardArgs,
  readArgs,
  readMaybeAll,
  readViewOptions,
  requireOperation,
} from "./shared.js";

export const POSITION_ACTIONS = [
  "info",
  "history",
  "adlRank",
  "close",
  "closeAll",
] as const;

/**
 * action → the catalog operation it routes to (for discover drill-down).
 *
 * `close` and `closeAll` deliberately share the close-positions op: that
 * endpoint closes ONE position when given a `symbol` and the WHOLE category when
 * not. Splitting it into two named intents lets `close` hard-require `symbol`
 * (single-position, safe) while `closeAll` is the explicit category-wide flatten.
 */
const POSITION_ACTION_OPS: Record<(typeof POSITION_ACTIONS)[number], string> = {
  info: "getPositionInfo",
  history: "getPositionsHistory",
  adlRank: "getPositionAdlRank",
  close: "closeAllPositions",
  closeAll: "closeAllPositions",
};

/** One-line, agent-facing description per action; `composeActionDoc` appends
 *  the `(needs: …)` required-param hint from the catalog. */
const POSITION_ACTION_DOCS: Record<(typeof POSITION_ACTIONS)[number], string> = {
  info: "current positions",
  history: "historical positions",
  adlRank: "ADL ranking",
  close: "close ONE position by symbol, at market (destructive)",
  closeAll: "close ALL positions in a category, at market (destructive)",
};

function positionSchema(): JsonSchema {
  const business = mergeProjected(projectUnion(Object.values(POSITION_ACTION_OPS)), {
    category: {
      type: "string",
      description: "Product category, e.g. USDT-FUTURES (required by info/history).",
    },
    symbol: { type: "string", description: "Optional symbol filter, e.g. BTCUSDT." },
    posSide: { type: "string", description: "Position side filter (long/short)." },
  });

  return {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [...POSITION_ACTIONS],
        description: `What to do — ${composeActionDoc(
          POSITION_ACTIONS.map((name) => ({
            name,
            operationId: POSITION_ACTION_OPS[name],
            description: POSITION_ACTION_DOCS[name],
          })),
        )}.`,
      },
      ...business,
      fetchAll: {
        type: "boolean",
        description: "history only: walk the cursor to bounded completion.",
      },
      confirm: {
        type: "boolean",
        description: "Required to execute close/closeAll (destructive market close).",
      },
      dryRun: {
        type: "boolean",
        description: "Preview a close/closeAll without sending it.",
      },
      ...VIEW_SCHEMA_PROPS,
    },
    required: ["action"],
    additionalProperties: true,
  };
}

/**
 * `position` — read positions and close them by intent (design §C).
 *
 * info/history/adlRank are normalized reads (history paginates); closeAll fans
 * out to the destructive `closeAllPositions` op, which requires `confirm` via
 * the shared safety gate.
 */
export function buildPositionTool(): ToolSpec {
  return {
    name: "position",
    module: "core",
    domain: "trade",
    fronts: [
      "getPositionInfo",
      "getPositionsHistory",
      "getPositionAdlRank",
      "closeAllPositions",
    ],
    actions: POSITION_ACTION_OPS,
    method: "POST",
    path: "(composite)",
    auth: "private",
    isWrite: false,
    riskLevel: "write",
    description:
      "[VERB] Positions by intent: info (current) | history | adlRank | close (ONE position by symbol, at market) | closeAll (every position in a category). close & closeAll are destructive and require confirm; reads are normalized and history paginates.",
    inputSchema: positionSchema(),
    handler: async (args, context): Promise<ToolResult> => {
      const action = assertEnum(args, "action", POSITION_ACTIONS, {
        required: true,
      })!;
      const viewOptions = readViewOptions(args);

      switch (action) {
        case "info":
          return callRead(
            context,
            "getPositionInfo",
            readArgs(args),
            viewOptions,
          );

        case "history":
          return readMaybeAll(context, "getPositionsHistory", args, viewOptions);

        case "adlRank":
          return callRead(
            context,
            "getPositionAdlRank",
            readArgs(args),
            viewOptions,
          );

        case "close": {
          // Single-position market close. close-positions scopes to ONE position
          // when `symbol` is set; WITHOUT a symbol it closes the WHOLE category, so
          // the named `close` intent hard-requires symbol to make that accident
          // impossible. (closeAll is the explicit category-wide flatten.)
          if (!readString(args, "symbol")) {
            throw new ValidationError(
              "`close` requires a `symbol` (e.g. BTCUSDT) — it closes that one position at market.",
              "Pass --symbol <pair> (add --posSide long|short in hedge mode), or use action closeAll to flatten every position in a category.",
            );
          }
          return executeWithSafety(
            requireOperation("closeAllPositions"),
            forwardArgs(args),
            context,
          );
        }

        case "closeAll":
          return executeWithSafety(
            requireOperation("closeAllPositions"),
            forwardArgs(args),
            context,
          );
      }
    },
  };
}
