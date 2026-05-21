import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    alias: {
      "bitget-agent-sdk/testing": here("./src/testing/index.ts"),
      "bitget-agent-sdk": here("./src/index.ts"),
    },
  },
});
