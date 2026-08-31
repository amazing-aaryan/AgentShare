import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Windows owner-only ACL enforcement launches the native security helper.
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["packages/*/src/*.ts", "apps/*/src/*.ts"],
      exclude: ["**/src/bin.ts", "**/src/start.ts"],
      thresholds: {
        branches: 50,
        functions: 70,
        lines: 65,
        statements: 63,
        "packages/acb/src/**.ts": {
          branches: 70,
          functions: 80,
          lines: 85,
          statements: 85,
        },
        "packages/contracts/src/**.ts": {
          branches: 80,
          functions: 90,
          lines: 90,
          statements: 90,
        },
        "packages/cli/src/handoff.ts": {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        "packages/cli/src/retrieval.ts": {
          branches: 55,
          functions: 85,
          lines: 90,
          statements: 90,
        },
        "apps/relay/src/handler.ts": {
          branches: 65,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
  },
});
