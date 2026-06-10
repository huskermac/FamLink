import { coverageConfigDefaults, defineConfig } from "vitest/config";

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
      thresholds: { lines: 80 },
      // Coverage measures product code: spike scripts, test helpers/setup,
      // and process bootstrap are excluded from the denominator.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "src/scripts/**",
        "src/__tests__/**",
        "src/index.ts",
        "src/loadEnv.ts"
      ]
    },
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 60_000
  }
});
