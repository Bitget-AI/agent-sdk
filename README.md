<p align="center">
  <img src="assets/logo.png" alt="Bitget Agent SDK — TypeScript foundation library for Bitget UTA v3 API trading bot development" width="120" />
</p>

<h1 align="center">bitget-agent-sdk — Official Bitget AI Trading TypeScript SDK</h1>

<p align="center">
  <strong>The foundation TypeScript SDK for the Bitget Unified Trading Account (UTA / v3) REST API — exposed as AI-callable Intent tools, with HMAC-SHA256 signing and client-side rate limiting.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bitget-ai/bitget-agent-sdk"><img src="https://img.shields.io/npm/v/%40bitget-ai%2Fbitget-agent-sdk.svg?style=flat-square&color=6f42c1&label=npm" alt="Bitget Agent SDK npm package version" /></a>
  <a href="https://www.npmjs.com/package/@bitget-ai/bitget-agent-sdk"><img src="https://img.shields.io/npm/dm/%40bitget-ai%2Fbitget-agent-sdk.svg?style=flat-square&color=026e00&label=downloads" alt="Bitget Agent SDK monthly downloads" /></a>
  <img src="https://img.shields.io/npm/types/%40bitget-ai%2Fbitget-agent-sdk.svg?style=flat-square" alt="TypeScript type definitions included" />
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A520-026e00?style=flat-square" alt="Requires Node.js 20 or higher" />
  <img src="https://img.shields.io/badge/zero%20runtime%20deps-none-lightgrey?style=flat-square" alt="Zero runtime dependencies" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="MIT open source license" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#modules">Modules</a> ·
  <a href="#testing">Testing</a> ·
  <a href="#error-handling">Error Handling</a> ·
  <a href="#faq">FAQ</a>
</p>

---

## Overview

`@bitget-ai/bitget-agent-sdk` is the **foundation TypeScript SDK** of the Bitget Agent Hub ecosystem. It provides:

- **89 UTA operations** with full JSON Schema
- **14 curated Intent verbs** for AI tool-use frameworks, plus `raw` and `discover` meta tools
- **HMAC-SHA256 request signing** and client-side rate limiting
- **Zero runtime dependencies** — lightweight and tree-shakeable (`"sideEffects": false`)

Both [`bitget-agent-cli`](https://github.com/Bitget-AI/agent-cli) and [`bitget-agent-mcp`](https://github.com/Bitget-AI/agent-mcp) are built on top of this SDK.

> **For developers**: Building quant strategies, custom MCP servers, LLM tool-use pipelines, or automated trading bots.
> **Not a developer?** Use the higher-level surfaces: `bitget-agent-cli` + `bitget-agent-skill` for terminal AI, `bitget-agent-mcp` for desktop AI, `bitget-signal` for market analysis with no account needed. None of them require this SDK directly.

---

## Quick Start

### Install

```bash
npm install @bitget-ai/bitget-agent-sdk
```

### Basic Usage

```typescript
import {
  loadConfig,
  buildTools,
  BitgetRestClient,
  safeInvoke,
} from "@bitget-ai/bitget-agent-sdk";

// Default surface is "intent" (curated verbs + raw + discover).
// Starting with readOnly is a safe default — every write tool is dropped.
const config = loadConfig({ modules: "all", readOnly: true });
const client = new BitgetRestClient(config);
const tools = buildTools(config);
const ctx = { config, client };

console.log(`Loaded ${tools.length} tools`); // intent verbs + raw + discover

// Public market data — no credentials required.
const market = tools.find((t) => t.name === "market")!;
const res = await safeInvoke(
  market,
  { action: "tickers", category: "SPOT", symbol: "BTCUSDT" },
  ctx,
);

if (res.ok) console.log(res.data);
else console.error(res.error);
```

### Set Credentials

Credentials are read from environment variables — the SDK does not parse `.env` files and never writes credentials to disk:

```bash
export BITGET_API_KEY="your-api-key"
export BITGET_SECRET_KEY="your-secret-key"
export BITGET_PASSPHRASE="your-passphrase"
```

Or pass them inline to `loadConfig({ apiKey, secretKey, passphrase, ... })`.

---

## Features

### What It Does for You

| Feature | What It Replaces |
|---|---|
| **89 UTA operations** with **14 curated Intent verbs**, mountable to any LLM framework in one call | Hand-rolling endpoint wrappers and keeping them in sync |
| **`safeInvoke`** — every call resolves to `{ ok, … }`, never throws | Wrapping every tool call in your own try/catch |
| **`discover`** — the surface describes itself to your model, drill in on demand | Maintaining a separate tool catalog just for prompts |
| **Request signing** (HMAC-SHA256) + client-side rate limiting + typed errors | Re-implementing Bitget's auth spec yourself |
| **Safety modes**: `readOnly` + `paperTrading`, high-risk ops require explicit `confirm` | Writing your own guardrails against accidental live orders |

### Key Exports

```typescript
// Client + tool primitives
import {
  BitgetRestClient,
  buildTools,
  toToolSpec,
  loadConfig,
  safeInvoke,
  toMcpTool,
} from "@bitget-ai/bitget-agent-sdk";

// Curated verbs, discovery, raw
import {
  COMPOSITE_TOOL_NAMES,
  buildDiscoverTool,
  DISCOVER_TOOL_NAME,
  RAW_TOOL_NAME,
} from "@bitget-ai/bitget-agent-sdk";

// The generated catalog (single source of truth)
import {
  CATALOG,
  CATALOG_SPEC_VERSION,
  CATALOG_OPERATION_COUNT,
  getOperation,
} from "@bitget-ai/bitget-agent-sdk";

// Types
import type {
  BitgetConfig,
  CliOptions,
  Surface,
  ToolSpec,
  ToolContext,
  ToolResult,
  SafeResult,
  ModuleId,
} from "@bitget-ai/bitget-agent-sdk";

// Metadata
import {
  SERVER_NAME,
  SERVER_VERSION,
  API_VARIANT,
  MODULES,
  DEFAULT_MODULES,
} from "@bitget-ai/bitget-agent-sdk";

// Errors — all subclasses of BitgetMcpError
import {
  BitgetMcpError,
  BitgetApiError,
  ConfigError,
  ValidationError,
  RateLimitError,
  AuthenticationError,
  NetworkError,
  toToolErrorPayload,
} from "@bitget-ai/bitget-agent-sdk";
```

Everything exported from the package root or the `@bitget-ai/bitget-agent-sdk/testing` subpath follows [semver](https://semver.org). Anything not exported from those paths is internal and may change without notice.

---

## Usage

### Control Tool Scope & Safety

`loadConfig` accepts these commonly-used options:

| Option | Default | Effect |
|---|---|---|
| `surface` | `"intent"` | `"intent"` (default) exposes the curated verbs + `raw` + `discover`. `"full"` additionally emits one 1:1 tool per operation. |
| `modules` | `"account,trade,market"` | Comma-separated module list, or `"all"`. Gates which tools are surfaced. |
| `readOnly` | `false` | Drop every write tool; reads only. Mutually exclusive with `paperTrading`. |
| `paperTrading` | `false` | Send orders to Bitget paper trading. Mutually exclusive with `readOnly`. |
| `baseUrl` | `https://api.bitget.com` | API base URL (or `BITGET_API_BASE_URL`). |
| `timeoutMs` | `15000` | Per-request timeout in ms (or `BITGET_TIMEOUT_MS`). |

Every tool carries a `riskLevel` of `read` < `write` < `high`. High-risk operations self-gate: they return a `{ confirmationRequired: true }` preview until you pass `confirm`, so an agent can't fire a destructive call on its first turn. This holds on **every** path — the curated verbs, the 1:1 operation tools, and the `raw` escape hatch all flow through one safety chokepoint.

### Explore at Runtime

`discover` lets a model learn the surface progressively, without you shipping a separate tool catalog in the prompt:

```typescript
const discover = tools.find((t) => t.name === "discover")!;

await safeInvoke(discover, {}, ctx);                                    // domains + tool counts
await safeInvoke(discover, { domain: "trade" }, ctx);                   // tools in a domain
await safeInvoke(discover, { tool: "market" }, ctx);                    // one tool's full schema
await safeInvoke(discover, { tool: "market", action: "tickers" }, ctx); // one action's exact contract
await safeInvoke(discover, { search: "funding" }, ctx);                 // keyword search
```

### Intent Verbs (Default Surface)

The default `intent` surface exposes **14 curated verbs**, each gated on its module being enabled. These 14 cover the generally-available modules:

| Verb | Module | Reaches |
|---|---|---|
| `market` | `market` | tickers, order book, candles, funding rate, open interest, reference reads |
| `order` | `trade` | place / amend / cancel orders, current & historical orders, fills |
| `position` | `trade` | open positions, leverage & margin mode, position history |
| `strategy_order` | `trade` | trigger / TP-SL / plan orders |
| `account_overview` | `account` | balances, assets, bills |
| `account_config` | `account` | account mode, margin & leverage settings |
| `transfer_funds` | `account` | internal & sub-account transfers |
| `deposit` | `account` | deposit address & records |
| `withdraw` | `account` | withdrawals & records |
| `funds_records` | `account` | deposit / withdraw / transfer history |
| `repayment` | `account` | liability repayment |
| `subaccount` | `account` | sub-account create / list / manage |
| `loan` | `cryptoloans` | borrow, repay, collateral, loan records |
| `tax` | `tax` | transaction tax records |

Plus two always-present meta tools:

- **`raw`** — the escape hatch. Call any operation directly by `operationId` when you want the exact 1:1 contract. It routes through the **same safety gate** as the curated verbs — `readOnly`, `dryRun`, and the high-risk `confirm` requirement all still apply, so `raw` widens *reach* without ever skipping a destructive-action confirmation.
- **`discover`** — introspect the active surface (see above). Both are available in every surface and every mode.

---

## Modules

The default profile loads `account` + `trade` + `market`, covering everyday trading. Load everything with `loadConfig({ modules: "all" })`, or pick a named subset:

| Module | Operations | Default | Description |
|---|:---:|:---:|---|
| `account` | 39 | ✅ | Balances & assets, account settings, transfers, deposit/withdraw, funding records, sub-accounts |
| `trade` | 17 | ✅ | Order placement & management (spot + futures), positions, fills |
| `market` | 16 | ✅ | Public market data — tickers, order book, candles, funding rate, open interest |
| `strategy` | 5 | — | Strategy orders — trigger, TP/SL, plan orders |
| `cryptoloans` | 11 | — | Crypto-backed loans — borrow, repay, collateral, records |
| `tax` | 1 | — | Transaction tax records |
| **Total (visible)** | **89** | **72** | |

> **Classic account users**: If you are on a Bitget classic account, you need to create an Agent sub-account via the API first, then use that sub-account's API key to call MCP / CLI / Skill tools. [Create Agent Sub-Account →](https://www.bitget.com/zh-CN/api-doc/classic/common/vsubaccount/Create-Agent-Subaccount)

---

## Testing

Import an in-memory Bitget API simulator from the `@bitget-ai/bitget-agent-sdk/testing` subpath for integration tests — no real API key required:

```typescript
import { MockServer, seedState } from "@bitget-ai/bitget-agent-sdk/testing";
import { loadConfig, BitgetRestClient } from "@bitget-ai/bitget-agent-sdk";

const mock = new MockServer();
await mock.start(); // ephemeral port

const config = loadConfig({
  modules: "market",
  baseUrl: mock.baseUrl,
  apiKey: "test",
  secretKey: "test",
  passphrase: "test",
});
const client = new BitgetRestClient(config);

// ... drive your tests against `client` ...

await mock.stop();
```

---

## Error Handling

Two complementary layers:

**1. `safeInvoke` — the recommended path.** It never throws. Branch on `.ok`:

```typescript
const res = await safeInvoke(tool, args, ctx);
if (res.ok) {
  // res.data, res.endpoint, res.requestTime
} else {
  // res.error — a JSON-serialisable payload, ready for an LLM tool-use reply
}
```

**2. Typed errors — when you call a handler directly.** Every API failure and config problem surfaces as a typed `Error` subclass you can `instanceof`-narrow:

```typescript
import { BitgetApiError, ConfigError, RateLimitError } from "@bitget-ai/bitget-agent-sdk";

try {
  await tool.handler(args, ctx);
} catch (err) {
  if (err instanceof RateLimitError) {
    // SDK applies client-side rate limiting, but Bitget can still 429 under load — back off and retry
  } else if (err instanceof BitgetApiError) {
    console.error(err.code, err.message);
  } else if (err instanceof ConfigError) {
    // Missing or invalid credentials — surface to the user
  }
}
```

Use `toToolErrorPayload(err)` to convert any caught error into the same `{ ok: false, error: { … } }` payload `safeInvoke` produces.

---

## Security

- **Credentials from environment variables only**: API keys are read via `export BITGET_API_KEY=...` — the SDK does not parse `.env` files and never writes credentials to disk.
- **Signed locally**: all authenticated requests are signed in-process with HMAC-SHA256 before reaching Bitget's API — no third-party server is involved.
- **Client-side rate limiting**: built-in throttling prevents loops from hitting Bitget's API limits.

---

## Compatibility

| | |
|---|---|
| **Node.js** | ≥ 20.0.0 |
| **Module format** | ESM only (`"type": "module"`). Tree-shaking enabled (`"sideEffects": false`). |
| **TypeScript** | Types ship in the package; no `@types/...` install needed. Module resolution is `NodeNext`. |
| **Dependencies** | Zero runtime dependencies. |
| **Bitget API** | Bitget Unified Trading Account (UTA / v3). |

---

## Documentation

- **In-core discovery.** The `discover` tool returns the live, config-aware tool surface and each operation's contract; no external catalog to keep in sync.
- **Bitget API reference.** [bitget.com/api-doc](https://www.bitget.com/api-doc/common/intro)

---

## Related Projects

| Package | Purpose |
|---|---|
| **[bitget-agent-cli](https://github.com/Bitget-AI/agent-cli)** | Terminal AI tool (built on SDK) |
| **[bitget-agent-mcp](https://github.com/Bitget-AI/agent-mcp)** | Desktop AI MCP server (built on SDK) |
| **[bitget-agent-skill](https://github.com/Bitget-AI/agent-skill)** | AI reasoning guide |
| **[bitget-signal](https://github.com/Bitget-AI/bitget-signal)** | Market analysis skills |
| **[agent-hub](https://github.com/Bitget-AI/agent_hub)** | Ecosystem entry point |

---

## FAQ

### What is bitget-agent-sdk?

`bitget-agent-sdk` is the official Bitget foundation TypeScript SDK — covering 89 UTA operations, with HMAC-SHA256 signing, client-side rate limiting, and a 14-verb Intent surface mountable into any LLM tool-use framework. Both `bitget-agent-cli` and `bitget-agent-mcp` are built on top of it, making it the foundational layer of the entire Bitget Agent Hub ecosystem.

### What developer use cases is this SDK designed for?

Building quantitative trading strategies, custom MCP servers, LLM tool-use pipelines, automated trading bots, and any TypeScript or JavaScript project that needs programmatic access to Bitget's UTA API.

### How is this different from calling the Bitget REST API directly?

The SDK handles HMAC-SHA256 request signing, client-side rate limiting, and typed error classes. It provides 14 curated Intent verbs plus the `raw` escape hatch, all mountable into any LLM tool-use framework. `safeInvoke` gives every call a uniform `{ ok, … }` shape — no need to wrap each handler in try/catch yourself.

### Does this SDK support CommonJS?

No, it is ESM-only (`"type": "module"`). Requires Node.js ≥ 20 and `NodeNext` module resolution.

### How do I load only specific modules?

Pass a comma-separated list, e.g. `loadConfig({ modules: "account,trade" })`, or `loadConfig({ modules: "all" })` for every module.

### I'm on a classic Bitget account — can I use this?

Yes, but classic accounts need to create an Agent sub-account first via the API, then use that sub-account's API key for MCP / CLI / Skill tools. [View the Create Agent Sub-Account API →](https://www.bitget.com/zh-CN/api-doc/classic/common/vsubaccount/Create-Agent-Subaccount)

### Is it officially from Bitget and free to use?

Yes. It is an official open-source SDK published by Bitget under the MIT license, free to use.

---

## License

[MIT](LICENSE) — Bitget Agent SDK

<sub>Official Bitget Agent Hub tool · Trading Stack · Foundation layer. Surfaces built on this SDK: agent-cli · agent-mcp · agent-skill</sub>
