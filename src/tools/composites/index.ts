import type { BitgetConfig } from "../../config.js";
import type { ModuleId } from "../../constants.js";
import type { ToolSpec } from "../types.js";
import { buildMarketTool } from "./market.js";
import { buildOrderTool } from "./order.js";
import { buildPositionTool } from "./position.js";
import { buildStrategyOrderTool } from "./strategy-order.js";
import { buildAccountOverviewTool } from "./account-overview.js";
import { buildAccountConfigTool } from "./account-config.js";
import { buildRepayTool } from "./repay.js";
import { buildTransferTool } from "./transfer.js";
import { buildDepositTool } from "./deposit.js";
import { buildWithdrawTool } from "./withdraw.js";
import { buildFundsRecordsTool } from "./funds-records.js";
import { buildSubaccountTool } from "./subaccount.js";
import { buildBrokerTool } from "./broker.js";
import { buildLoanTool } from "./loan.js";
import { buildInstLoanTool } from "./inst-loan.js";
import { buildTaxTool } from "./tax.js";

/**
 * Names of the curated intent verbs (Tier 1), in canonical domain order, for
 * discovery / manifest use. Their `fronts` union covers every catalog op, so
 * the intent surface loses no capability versus the 1:1 generated tier.
 */
export const COMPOSITE_TOOL_NAMES = [
  "market",
  "order",
  "position",
  "strategy_order",
  "account_overview",
  "account_config",
  "repayment",
  "transfer_funds",
  "deposit",
  "withdraw",
  "funds_records",
  "subaccount",
  "broker",
  "loan",
  "inst_loan",
  "tax",
] as const;

interface CompositeEntry {
  /** Module that must be enabled for this composite to appear. */
  primaryModule: ModuleId;
  build: () => ToolSpec;
}

/**
 * The intent tier, gated by primary module. `strategy_order` is gated on
 * `trade` (not `strategy`) because strategy orders are a trading capability an
 * agent expects whenever trading is enabled; the client can call strategy-module
 * operations regardless of which tools are surfaced. Funds/sub-account verbs are
 * carved out of the `account` module the same way.
 */
const COMPOSITES: CompositeEntry[] = [
  { primaryModule: "market", build: buildMarketTool },
  { primaryModule: "trade", build: buildOrderTool },
  { primaryModule: "trade", build: buildPositionTool },
  { primaryModule: "trade", build: buildStrategyOrderTool },
  { primaryModule: "account", build: buildAccountOverviewTool },
  { primaryModule: "account", build: buildAccountConfigTool },
  { primaryModule: "account", build: buildRepayTool },
  { primaryModule: "account", build: buildTransferTool },
  { primaryModule: "account", build: buildDepositTool },
  { primaryModule: "account", build: buildWithdrawTool },
  { primaryModule: "account", build: buildFundsRecordsTool },
  { primaryModule: "account", build: buildSubaccountTool },
  { primaryModule: "broker", build: buildBrokerTool },
  { primaryModule: "cryptoloans", build: buildLoanTool },
  { primaryModule: "instloan", build: buildInstLoanTool },
  { primaryModule: "tax", build: buildTaxTool },
];

/**
 * Build the curated composite verb tier (Tier 1). Each composite is gated on
 * its primary module being enabled, so `modules: "market"` yields only `market`
 * while `modules: "all"` yields the whole surface. Composites are kept even in
 * readOnly mode — their read actions stay useful and their writes self-block via
 * the shared safety gate — mirroring the always-on `raw` escape hatch.
 */
export function buildCompositeTools(config: BitgetConfig): ToolSpec[] {
  const moduleSet = new Set(config.modules);
  const tools: ToolSpec[] = [];
  for (const entry of COMPOSITES) {
    if (moduleSet.has(entry.primaryModule)) {
      tools.push(entry.build());
    }
  }
  return tools;
}
