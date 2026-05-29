# bitget-agent-sdk

[![npm](https://img.shields.io/npm/v/bitget-agent-sdk.svg)](https://www.npmjs.com/package/bitget-agent-sdk)
[![Types](https://img.shields.io/npm/types/bitget-agent-sdk.svg)](https://www.npmjs.com/package/bitget-agent-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

The **Foundation SDK** of the [Bitget Agent Hub](https://github.com/bitget/agent-hub) — Bitget's full REST API surface as 56+ AI-callable tools, with a typed TypeScript core and a built-in mock server for testing.

```bash
npm install bitget-agent-sdk
```

> **Requirements:** Node.js ≥ 20. Pure ESM — `import` only, no `require()`.

## Why this package

If you are **writing code** against the Bitget API — quant strategies, trading bots, custom MCP servers, internal platform tooling — this is the package you want. It exposes a registry of 56+ Bitget tools (spot, futures, margin, copy-trading, earn, broker, p2p, convert, account) with consistent schemas, ready to plug into any AI agent or LLM tool-use framework.

If you instead want to **operate** a Bitget account from your shell or AI assistant, you don't need this directly — pick one of the surfaces built on top:

- [`bitget-agent-cli`](https://github.com/bitget/agent-cli) — the `bgc` shell CLI
- [`bitget-agent-mcp`](https://github.com/bitget/agent-mcp) — MCP server for Claude Desktop, Cursor, Continue
- [`bitget-agent-skill`](https://github.com/bitget/agent-skill) — Claude Code / Codex skill on top of `bgc`

## Quick start

```ts
import { loadConfig, buildTools, BitgetRestClient } from "bitget-agent-sdk";

const config = loadConfig({ modules: "all", readOnly: false });
const tools = buildTools(config);
const client = new BitgetRestClient(config);

// Each tool: { name, description, module, isWrite, inputSchema, handler }
console.log(`Loaded ${tools.length} tools`);

// Invoke a tool
const ticker = tools.find((t) => t.name === "spot_get_ticker")!;
const result = await ticker.handler(
  { symbol: "BTCUSDT" },
  { config, client },
);
```

## Public API

```ts
// Client + tooling primitives
import { BitgetRestClient, buildTools, loadConfig } from "bitget-agent-sdk";

// Types
import type {
  BitgetConfig,
  CliOptions,
  ToolSpec,
  ToolContext,
  ModuleId,
} from "bitget-agent-sdk";

// Metadata
import {
  SERVER_NAME,
  SERVER_VERSION,
  MODULES,
  DEFAULT_MODULES,
} from "bitget-agent-sdk";

// Errors
import {
  BitgetMcpError,
  BitgetApiError,
  ConfigError,
  ValidationError,
  RateLimitError,
  AuthenticationError,
  NetworkError,
  toToolErrorPayload,
} from "bitget-agent-sdk";
```

The SDK follows [semver](https://semver.org). Anything not exported from the package root or the `bitget-agent-sdk/testing` subpath is internal and may change without notice.

## Modules and tools

| Module | Tools | Loaded by default |
|--------|:-----:|:-----------------:|
| `spot` | 13 | ✅ |
| `futures` | 14 | ✅ |
| `account` | 8 | ✅ |
| `margin` | 7 | — |
| `copytrading` | 5 | — |
| `convert` | 3 | — |
| `earn` | 3 | — |
| `p2p` | 2 | — |
| `broker` | 3 | — |

Default: 35 tools (fits Cursor's 40-tool MCP limit). Load everything: `loadConfig({ modules: "all" })`.

## Testing with the built-in mock server

The `bitget-agent-sdk/testing` subpath ships an in-memory Bitget API simulator so you can integration-test against real client code without touching live endpoints.

```ts
import { MockServer } from "bitget-agent-sdk/testing";
import { loadConfig, BitgetRestClient } from "bitget-agent-sdk";

const mock = new MockServer();
await mock.start();

const config = loadConfig({
  modules: "spot",
  readOnly: false,
  baseUrl: mock.url,
  apiKey: "test",
  apiSecret: "test",
  passphrase: "test",
});
const client = new BitgetRestClient(config);

// ... drive your tests against `client` ...

await mock.stop();
```

You can also run the mock as a standalone HTTP process — useful for shell-based integration tests or hand-driving requests with `curl`:

```bash
npx bitget-mock-server --port 9876
# Mock listening on http://127.0.0.1:9876
```

The `bitget-mock-server` binary ships with this package; no separate install needed.

## Error handling

All Bitget API failures and config problems are surfaced as typed `Error` subclasses you can `instanceof`-narrow:

```ts
import {
  BitgetApiError,
  ConfigError,
  ValidationError,
  RateLimitError,
} from "bitget-agent-sdk";

try {
  await tool.handler(args, ctx);
} catch (err) {
  if (err instanceof RateLimitError) {
    // Back off and retry — SDK already applies client-side rate limiting
    // by default, but Bitget can still 429 under load.
  } else if (err instanceof BitgetApiError) {
    console.error(err.code, err.message);
  } else if (err instanceof ConfigError) {
    // Missing/invalid credentials — surface to the user
  }
}
```

For surfacing errors to LLM tool-use frameworks, use `toToolErrorPayload(err)` to get a JSON-serialisable error payload with `{ ok: false, error: { type, message, ... } }`.

## Compatibility

- **Node.js:** ≥ 20.0.0
- **Module format:** ESM only (`"type": "module"`). Tree-shaking enabled (`"sideEffects": false`).
- **TypeScript:** types ship in the package; no `@types/...` install needed.
- **Bundlers:** verified with `tsup`, `esbuild`, `rollup`, `vite`. The `./testing` subpath is excluded from the main entry chunk so production bundles do not pull in the mock server.

## Documentation

Full reference — modules, tool catalog, error codes, architecture — lives in the portal: [bitget/agent-hub](https://github.com/bitget/agent-hub).

## License

[MIT](LICENSE)

---

Part of the **[Bitget Agent Hub](https://github.com/bitget/agent-hub)** — Trading Stack · Foundation.

Surfaces: [agent-cli](https://github.com/bitget/agent-cli) · [agent-mcp](https://github.com/bitget/agent-mcp) · [agent-skill](https://github.com/bitget/agent-skill)
