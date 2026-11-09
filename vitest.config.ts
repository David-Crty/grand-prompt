import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    testTimeout: 120_000,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/viewer/src/lib/**/*.ts", "apps/viewer/server/**/*.ts"],
      // The CLI entry and the build's process and terminal handling (bwrap, the model CLIs, Ink) are run by
      // hand; the build's pure parts (build/lib.ts) are tested.
      exclude: [
        "packages/cli/src/main.ts",
        "packages/cli/src/build/index.tsx",
        "packages/cli/src/build/run.ts",
        "packages/cli/src/build/ui.tsx",
        "**/*.d.ts",
      ],
      reporter: ["text-summary", "text", "html"],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 90 },
    },
  },
});
