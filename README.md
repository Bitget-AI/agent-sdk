# bitget-agent-sdk

[![npm](https://img.shields.io/npm/v/bitget-agent-sdk.svg)](https://www.npmjs.com/package/bitget-agent-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

The **Foundation SDK** of the [Bitget Agent Hub](https://github.com/bitget/agent-hub) — Bitget's full API surface as 56+ AI-callable tools, plus a built-in mock server for testing.

```bash
npm install bitget-agent-sdk
```

## Why this package

If you are **writing code** against the Bitget API — quant strategies, trading bots, internal platform tooling — this is the package you want. It exposes a registry of 56+ Bitget tools (spot, futures, margin, copy-trading, earn, broker, p2p, convert, account) with consistent schemas, ready to plug into any AI agent or LLM tool-use framework.

If you instead want to **operate** a Bitget account from your shell or AI assistant, you don't need this — pick one of the surfaces:
- [`bitget-client`](https://github.com/bitget/agent-cli) — `bgc` CLI
- [`bitget-mcp-server`](https://github.com/bitget/agent-mcp) — MCP server for Claude Desktop, Cursor, Continue
- [`bitget-skill`](https://github.com/bitget/agent-skill) — Claude Code / Codex skill on top of `bgc`

## Quick start

```ts
import { loadConfig, buildTools, BitgetRestClient } from "bitget-agent-sdk";

const config = loadConfig({ modules: "all", readOnly: false });
const tools = buildTools(config);
const client = new BitgetRestClient(config);

// Each tool has { name, description, module, isWrite, inputSchema }
console.log(`Loaded ${tools.length} tools`);
```

## Testing with the built-in mock server

```ts
import { MockServer } from "bitget-agent-sdk/testing";
import { loadConfig, BitgetRestClient } from "bitget-agent-sdk";

const mock = new MockServer();
await mock.start();
const config = loadConfig({
  modules: "spot",
  readOnly: false,
  baseUrl: mock.url,
  apiKey: "test", apiSecret: "test", passphrase: "test",
});
// ... run your tests
await mock.stop();
```

You can also run the mock server as a standalone process:

```bash
npx bitget-mock-server --port 9876
```

## Migration from `bitget-core`

This package was previously published as `bitget-core`. The old name continues to work as a thin re-export for compatibility, but new code should depend on `bitget-agent-sdk` directly.

```diff
- import { loadConfig } from "bitget-core";
+ import { loadConfig } from "bitget-agent-sdk";
```

## Documentation

Full reference, modules, error codes, and architecture lives in the portal:
[bitget/agent-hub](https://github.com/bitget/agent-hub).

## License

MIT

---

Part of the **[Bitget Agent Hub](https://github.com/bitget/agent-hub)** — Trading Stack · Foundation.
Surfaces: [agent-cli](https://github.com/bitget/agent-cli) · [agent-mcp](https://github.com/bitget/agent-mcp) · [agent-skill](https://github.com/bitget/agent-skill)
