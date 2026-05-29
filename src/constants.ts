export const SERVER_NAME = "bitget-agent-mcp";
export const SERVER_VERSION = "1.2.0";

export const MODULES = [
  "spot",
  "futures",
  "account",
  "margin",
  "copytrading",
  "convert",
  "earn",
  "p2p",
  "broker",
] as const;

export type ModuleId = (typeof MODULES)[number];

export const DEFAULT_MODULES: ModuleId[] = ["spot", "futures", "account"];
