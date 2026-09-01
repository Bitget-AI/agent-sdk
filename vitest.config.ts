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
      // Calibrated against the CI run in PR #3 (93.02% stmts / 90.65% branch / 96.62% funcs / 93.02% lines).
      thresholds: {
        lines: 85,
        functions: 90,
        statements: 85,
        branches: 85,
      },
    },
  },
});
