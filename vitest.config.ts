import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/viewer/src/lib/**/*.ts", "apps/viewer/server/**/*.ts"],
      exclude: ["packages/cli/src/main.ts", "**/*.d.ts"],
      reporter: ["text-summary", "text", "html"],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
