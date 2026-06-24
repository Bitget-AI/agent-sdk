import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `broker` — broker/partner sub-account management by intent (design §C).
 *
 * Broker sub-account lifecycle and API keys, sub-account withdrawals, deposit
 * reads, and commission reporting. Writes flow through the shared safety gate.
 */
export function buildBrokerTool(): ToolSpec {
  return buildActionTool({
    name: "broker",
    domain: "broker",
    description:
      "[VERB] Broker sub-accounts by intent: createSub | modifySub | listSubs | API keys (apiKeys/createApiKey/modifyApiKey/deleteApiKey) | withdraw | depositAddress | depositWithdrawRecords | commission.",
    properties: {
      subUid: { type: "string", description: "Target broker sub-account uid." },
      coin: { type: "string", description: "Coin filter for deposit/withdraw reads." },
    },
    actions: {
      createSub: { operationId: "createBrokerSubAccount", kind: "write", description: "create a broker sub-account" },
      modifySub: { operationId: "modifyBrokerSubAccount", kind: "write", description: "modify a broker sub-account" },
      listSubs: { operationId: "getBrokerSubAccountList", kind: "read", description: "list broker sub-accounts" },
      createApiKey: { operationId: "createBrokerSubAccountApiKey", kind: "write", description: "create a broker sub-account API key" },
      modifyApiKey: { operationId: "modifyBrokerSubAccountApiKey", kind: "write", description: "modify a broker sub-account API key" },
      deleteApiKey: { operationId: "deleteBrokerSubaccountApikey", kind: "write", description: "delete a broker sub-account API key" },
      apiKeys: { operationId: "getBrokerSubAccountApiKey", kind: "read", description: "list a broker sub-account's API keys" },
      withdraw: { operationId: "brokerSubaccountWithdrawal", kind: "write", description: "withdraw from a broker sub-account" },
      depositAddress: { operationId: "getBrokerSubaccountDepositAddress", kind: "read", description: "broker sub-account deposit address" },
      depositWithdrawRecords: {
        operationId: "getAllBrokerSubaccountDepositWithdrawal",
        kind: "readPaged",
        description: "broker sub-account deposit/withdrawal records",
      },
      commission: { operationId: "getBrokerCommission", kind: "read", description: "broker commission report" },
    },
  });
}
