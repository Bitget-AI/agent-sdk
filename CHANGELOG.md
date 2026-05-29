# Changelog

All notable changes to `bitget-agent-sdk` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-29

### Added
- **`bitget-agent-sdk/testing` subpath export** — ships an in-memory mock Bitget API server (`MockServer`) plus seedable fixtures (`SPOT_TICKERS`, `FUTURES_TICKERS`, `seedState`) for integration-testing client code without hitting live endpoints.
- **`bitget-mock-server` binary** — standalone HTTP entry point for the mock server (`npx bitget-mock-server --port 9876`), suitable for shell-based integration tests.
- **`sideEffects: false`** declaration — enables full tree-shaking by downstream bundlers.
- **Source files shipped alongside `dist/`** — published tarball includes `src/` so source maps and `.d.ts.map` references resolve correctly in IDEs and stack traces.
- **Provenance attestations** on published artefacts (`publishConfig.provenance: true`) for supply-chain verification on npm.

### Changed
- **Renamed package: `bitget-core` → `bitget-agent-sdk`.** The new name reflects the SDK's positioning as the foundation for Bitget AI-agent integrations and aligns with the `bitget-agent-*` family. The previous `bitget-core` name is no longer maintained on npm.
- **Minimum Node.js version: 20.0.0** (was 18). Node 18 reached end-of-life in April 2025.
- **Pure ESM distribution.** No CommonJS build is published. Consumers must use `import` (or dynamic `import()`); `require()` is not supported.
- **Module resolution: `NodeNext`** — types and runtime resolve via the `exports` field with the modern Node 16+ spec.
- **Repository moved** from monorepo `agent_hub/packages/bitget-core/` to standalone repo [`bitget/agent-sdk`](https://github.com/bitget/agent-sdk).

### Removed
- **`zod` runtime dependency** — was declared but never imported. Tool input schemas use plain JSON Schema; no validator runtime is shipped.
- **`bitget-test-utils` standalone package** — its functionality (mock server, fixtures) is now exposed through the `bitget-agent-sdk/testing` subpath of this package.

### Public API

The exported surface is unchanged from the prior `bitget-core` releases. Existing imports continue to work after a single text-replacement of the package name:

```diff
- import { loadConfig, buildTools, BitgetRestClient } from "bitget-core";
+ import { loadConfig, buildTools, BitgetRestClient } from "bitget-agent-sdk";

- import { MockServer } from "bitget-test-utils";
+ import { MockServer } from "bitget-agent-sdk/testing";
```

[1.2.0]: https://github.com/bitget/agent-sdk/releases/tag/v1.2.0
