// Flat ESLint config (ESLint 9 / typescript-eslint 8).
//
// Non-type-checked `recommended` on purpose: it needs no `parserOptions.project`,
// so it stays fast and cannot break from tsconfig drift. If we later want the
// type-aware rule set, swap `configs.recommended` for `configs.recommendedTypeChecked`
// and point `parserOptions.project` at ./tsconfig.json.
//
// Generated code (src/generated/**) is excluded — its shape is guaranteed by the
// catalog generator + the regression suite, not by lint.

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["lib/**", "node_modules/**", "coverage/**", "src/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Unused vars are errors, but an explicit `_`-prefix opts a binding out
      // (e.g. an intentionally-ignored callback arg).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `any` is discouraged but not fatal — the SDK has a few deliberate
      // boundary casts (wire payloads) that are clearer left as-is.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Tests may use non-null assertions and looser typing for fixtures.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
