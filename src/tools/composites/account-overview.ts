import { compactObject, readString } from "../helpers.js";
import { enrichProperties } from "../field-schemas.js";
import { applyView } from "../normalize.js";
import type { JsonSchema, ToolContext, ToolResult, ToolSpec } from "../types.js";
import { VIEW_SCHEMA_PROPS, readViewOptions } from "./shared.js";

interface Section {
  key: string;
  operationId: string;
  args: Record<string, unknown>;
}

function accountOverviewSchema(): JsonSchema {
  return {
    type: "object",
    properties: enrichProperties({
      coin: { type: "string", description: "Optional coin filter for funding assets." },
      category: {
        type: "string",
        description:
          "If provided, also fetches current positions (and fee rate when symbol is given too).",
      },
      symbol: {
        type: "string",
        description: "With category, also fetches the fee rate for this symbol.",
      },
      ...VIEW_SCHEMA_PROPS,
    }),
    additionalProperties: true,
  };
}

/**
 * `account_overview` — one call, a whole-account snapshot (design §C / P2).
 *
 * Fans out to the independent account reads in parallel and returns a labelled
 * section per source. Position/fee-rate reads need a category (and symbol), so
 * they are included only when those are supplied. `Promise.allSettled` means a
 * single failing section degrades to `{ ok: false, error }` instead of sinking
 * the whole snapshot.
 */
export function buildAccountOverviewTool(): ToolSpec {
  return {
    name: "account_overview",
    module: "core",
    domain: "account",
    fronts: [
      "getAccountAssets",
      "getAccountInfo",
      "getAccountFundingAssets",
      "getPositionInfo",
      "getAccountFeeRate",
    ],
    method: "GET",
    path: "(composite)",
    auth: "private",
    isWrite: false,
    riskLevel: "read",
    description:
      "[VERB] One-call account snapshot: fans out to assets, settings, funding assets, and (with category/symbol) positions and fee rate. Each section reports ok/error independently.",
    inputSchema: accountOverviewSchema(),
    handler: async (args, context): Promise<ToolResult> => {
      const viewOptions = readViewOptions(args);
      const coin = readString(args, "coin");
      const category = readString(args, "category");
      const symbol = readString(args, "symbol");

      const sections: Section[] = [
        { key: "assets", operationId: "getAccountAssets", args: {} },
        { key: "settings", operationId: "getAccountInfo", args: {} },
        {
          key: "fundingAssets",
          operationId: "getAccountFundingAssets",
          args: compactObject({ coin }),
        },
      ];
      if (category) {
        sections.push({
          key: "positions",
          operationId: "getPositionInfo",
          args: compactObject({ category, symbol }),
        });
      }
      if (category && symbol) {
        sections.push({
          key: "feeRate",
          operationId: "getAccountFeeRate",
          args: { category, symbol },
        });
      }

      const settled = await Promise.allSettled(
        sections.map((section) =>
          context.client.callOperation(section.operationId, section.args),
        ),
      );

      const overview: Record<string, unknown> = {};
      settled.forEach((outcome, index) => {
        const section = sections[index];
        if (!section) return;
        const { key } = section;
        if (outcome.status === "fulfilled") {
          overview[key] = {
            ok: true,
            data: applyView(outcome.value.data, viewOptions),
          };
        } else {
          const reason = outcome.reason;
          overview[key] = {
            ok: false,
            error: reason instanceof Error ? reason.message : String(reason),
          };
        }
      });

      return {
        endpoint: "(composite) account_overview",
        requestTime: new Date().toISOString(),
        data: overview,
      };
    },
  };
}
