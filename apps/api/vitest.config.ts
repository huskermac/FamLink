import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    globalSetup: ["src/__tests__/setup/globalSetup.ts"],
    setupFiles: [
      "src/__tests__/setup/loadTestEnv.ts",
      "src/__tests__/setup/afterEach.ts"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { lines: 80 }
    },
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 60_000
  }
});
