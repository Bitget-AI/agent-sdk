# bitget-core

> **Compatibility alias.** This package is now published from
> [`bitget/agent-sdk`](https://github.com/bitget/agent-sdk) under its new
> canonical name [`bitget-agent-sdk`](https://www.npmjs.com/package/bitget-agent-sdk).
> All exports re-export from `bitget-agent-sdk`.

## Migration

```diff
- import { loadConfig, buildTools } from "bitget-core";
+ import { loadConfig, buildTools } from "bitget-agent-sdk";
```

`bitget-core` will continue to work for the foreseeable future, but
new code should depend on `bitget-agent-sdk` directly.

Part of the **[Bitget Agent Hub](https://github.com/bitget/agent-hub)**.
