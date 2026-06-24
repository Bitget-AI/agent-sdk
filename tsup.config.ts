import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/testing/index.ts",
    "src/bin/mock-server.ts",
  ],
  outDir: "lib",
  format: ["esm"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: true,
});
