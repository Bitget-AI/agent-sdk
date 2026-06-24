import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    alias: {
      "@bitget-ai/bitget-agent-sdk/testing": here("./src/testing/index.ts"),
      "@bitget-ai/bitget-agent-sdk": here("./src/index.ts"),
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/generated/**", // generated catalog — guaranteed by the regression suite, not unit coverage
        "src/**/*.d.ts",
        "src/bin/**", // thin CLI entrypoints
      ],
      // Provisional floor. These thresholds have NOT been run yet (the offline
      // registry blocks installing @vitest/coverage-v8); calibrate them against
      // the first real `pnpm run coverage` report and adjust as needed.
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});
