# Changelog

All notable changes to `@bitget-ai/bitget-agent-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-06-17

Complete, ground-up rewrite targeting the **Bitget Unified Trading Account (UTA / v3) API**. This is a breaking major release: the entire endpoint surface and the AI-tool model are new and are not source-compatible with the 1.x line (which wrapped the older v2 API).

### Added
- **Spec-driven architecture.** A single source of truth (`openapi.yaml`) is compiled into a typed operation catalog (`src/generated/catalog.ts`) that drives every layer — REST client, AI-tool builder, and mock server — so a spec change propagates everywhere with no hand-editing.
- **Layered AI-tool model.** A curated "intent" surface (high-level verbs plus a `raw` escape hatch and a `discover` self-description tool) is exposed by default; an opt-in "full" surface additionally emits one tool per catalog operation.
- **Module-scoped loading & visibility controls.** Tools are grouped into modules (`account`, `trade`, `market`, `strategy`, `broker`, `cryptoloans`, `instloan`, `tax`); the default load is `account`, `trade`, `market`. The enterprise (to-B) modules `broker` and `instloan` are hidden by default — excluded even from `modules: "all"` — and surface only when named explicitly.
- **`readOnly` and `paperTrading` safety modes**, per-operation risk gating, and a uniform `{ ok, ... }` result envelope (`safeInvoke`) that never throws.
- **Catalog-driven mock server** (`@bitget-ai/bitget-agent-sdk/testing`) for hermetic, offline regression tests across the whole operation catalog.
- **`openapi.yaml` shipped in the published package** so consumers can read the exact spec the SDK was generated from.

### Changed
- **Publishing build no longer regenerates the catalog.** The committed `src/generated/catalog.ts` is the build input and `pnpm run build` runs `tsup` only — removing the Python/PyYAML dependency from the release path. Catalog regeneration (`pnpm run gen`) is a development-time step, run when `openapi.yaml` changes.

### Removed
- The entire 1.x (v2-API) tool set and route handlers — superseded by the spec-generated UTA surface.

[3.0.0]: https://github.com/Bitget-AI/agent-sdk/releases/tag/v3.0.0

## [1.2.0] - 2026-05-29

### Added
- **`@bitget-ai/bitget-agent-sdk/testing` subpath export** — ships an in-memory mock Bitget API server (`MockServer`) plus seedable fixtures (`SPOT_TICKERS`, `FUTURES_TICKERS`, `seedState`) for integration-testing client code without hitting live endpoints.
- **`bitget-mock-server` binary** — standalone HTTP entry point for the mock server (`npx bitget-mock-server --port 9876`), suitable for shell-based integration tests.
- **`sideEffects: false`** declaration — enables full tree-shaking by downstream bundlers.
- **Source files shipped alongside `dist/`** — published tarball includes `src/` so source maps and `.d.ts.map` references resolve correctly in IDEs and stack traces.

### Changed
- **Renamed package: `bitget-core` → `@bitget-ai/bitget-agent-sdk`.** The new name reflects the SDK's positioning as the foundation for Bitget AI-agent integrations and aligns with the `bitget-agent-*` family. The previous `bitget-core` name is no longer maintained on npm.
- **Minimum Node.js version: 20.0.0** (was 18). Node 18 reached end-of-life in April 2025.
- **Pure ESM distribution.** No CommonJS build is published. Consumers must use `import` (or dynamic `import()`); `require()` is not supported.
- **Module resolution: `NodeNext`** — types and runtime resolve via the `exports` field with the modern Node 16+ spec.
- **Repository moved** from monorepo `agent_hub/packages/bitget-core/` to standalone repo [`Bitget-AI/agent-sdk`](https://github.com/Bitget-AI/agent-sdk).

### Removed
- **`zod` runtime dependency** — was declared but never imported. Tool input schemas use plain JSON Schema; no validator runtime is shipped.
- **`bitget-test-utils` standalone package** — its functionality (mock server, fixtures) is now exposed through the `@bitget-ai/bitget-agent-sdk/testing` subpath of this package.

### Public API

The exported surface is unchanged from the prior `bitget-core` releases. Existing imports continue to work after a single text-replacement of the package name:

```diff
- import { loadConfig, buildTools, BitgetRestClient } from "bitget-core";
+ import { loadConfig, buildTools, BitgetRestClient } from "@bitget-ai/bitget-agent-sdk";

- import { MockServer } from "bitget-test-utils";
+ import { MockServer } from "@bitget-ai/bitget-agent-sdk/testing";
```

[1.2.0]: https://github.com/Bitget-AI/agent-sdk/releases/tag/v1.2.0
