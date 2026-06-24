import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `account_config` — account-level settings by intent (design §C).
 *
 * The account-mode / position-holding-mode / leverage / fee-deduction switches
 * and their companion status reads. Writes flow through the shared safety gate;
 * reads are normalized. Balances and positions live in `account_overview`, not
 * here.
 *
 * NOTE: there is no standalone cross/isolated *margin-mode* setter in v3 UTA —
 * the margin model follows the account mode, and isolated leverage is set
 * per-`posSide` via setLeverage. Do not describe holding mode as "margin mode";
 * holding mode is strictly one-way vs hedge (`setHoldingMode`).
 */
export function buildAccountConfigTool(): ToolSpec {
  return buildActionTool({
    name: "account_config",
    domain: "account",
    description:
      "[VERB] Account settings by intent: set account mode (basic/advanced), position holding mode (one-way/hedge), and leverage; switch account & fee-deduction; plus oiLimit / paymentCoins / switchStatus / deductInfo reads. (No standalone cross/isolated margin-mode switch in v3 — see setLeverage posSide for isolated.)",
    properties: {
      category: { type: "string", description: "Product category, e.g. USDT-FUTURES (leverage/oiLimit)." },
      symbol: { type: "string", description: "Trading pair where the setting is per-symbol." },
      coin: { type: "string", description: "Coin filter where applicable." },
    },
    actions: {
      setAccountMode: { operationId: "adjustAccountMode", kind: "write", description: "switch account mode (basic/advanced)" },
      setHoldingMode: { operationId: "setHoldingMode", kind: "write", description: "set position (one-way/hedge) mode" },
      setLeverage: { operationId: "setLeverage", kind: "write", description: "set leverage" },
      switchAccount: { operationId: "switchAccount", kind: "write", description: "switch active account" },
      switchDeduct: { operationId: "switchDeduct", kind: "write", description: "toggle fee deduction" },
      switchStatus: { operationId: "getSwitchStatus", kind: "read", description: "current account-switch status" },
      deductInfo: { operationId: "getDeductInfo", kind: "read", description: "fee-deduction settings" },
      oiLimit: { operationId: "getOiLimit", kind: "read", description: "open-interest limit" },
      paymentCoins: { operationId: "getPaymentCoins", kind: "read", description: "eligible fee-payment coins" },
    },
  });
}
