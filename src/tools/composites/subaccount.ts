import type { ToolSpec } from "../types.js";
import { buildActionTool } from "./action-tool.js";

/**
 * `subaccount` — manage unified-account sub-accounts by intent (design §C).
 *
 * Sub-account lifecycle (create / freeze), their API keys (create / modify /
 * delete / list), and their assets and deposit reads. Writes flow through the
 * shared safety gate.
 */
export function buildSubaccountTool(): ToolSpec {
  return buildActionTool({
    name: "subaccount",
    domain: "subaccount",
    description:
      "[VERB] Sub-accounts by intent: create | createAgent | list | freeze | assets | API keys (apiKeys/createApiKey/modifyApiKey/deleteApiKey) | depositAddress | depositRecords.",
    properties: {
      subUid: { type: "string", description: "Target sub-account uid." },
      coin: { type: "string", description: "Coin filter for deposit reads." },
    },
    actions: {
      create: { operationId: "createSubAccount", kind: "write", description: "create a sub-account" },
      createAgent: { operationId: "createAgentSubAccount", kind: "write", description: "create an Agent (broker) sub-account: username + passphrase (+ note)" },
      list: { operationId: "getSubAccountList", kind: "read", description: "list sub-accounts" },
      freeze: { operationId: "freezeUnfreezeSubAccount", kind: "write", description: "freeze/unfreeze a sub-account" },
      assets: { operationId: "getSubaccountUnifiedAssets", kind: "read", description: "sub-account unified assets" },
      apiKeys: { operationId: "getSubAccountApiKeys", kind: "read", description: "list a sub-account's API keys" },
      createApiKey: { operationId: "createSubAccountApiKey", kind: "write", description: "create a sub-account API key" },
      modifyApiKey: { operationId: "modifySubAccountApiKey", kind: "write", description: "modify a sub-account API key" },
      deleteApiKey: { operationId: "deleteSubAccountApiKey", kind: "write", description: "delete a sub-account API key" },
      depositAddress: { operationId: "getSubDepositAddress", kind: "read", description: "sub-account deposit address" },
      depositRecords: { operationId: "getSubDepositRecords", kind: "readPaged", description: "sub-account deposit history" },
    },
  });
}
