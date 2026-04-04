import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  /** Railway + seed + Supertest often exceeds Jest’s default 5s on slower networks */
  testTimeout: 60_000,
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  globalSetup: "<rootDir>/src/__tests__/setup/globalSetup.ts",
  globalTeardown: "<rootDir>/src/__tests__/setup/globalTeardown.ts",
  /**
   * Runs before Jest’s test framework is installed and before any test file is loaded.
   * Use for `process.env` only — no `jest` globals here.
   * @see https://jestjs.io/docs/configuration#setupfiles-array
   */
  setupFiles: ["<rootDir>/src/__tests__/setup/loadTestEnv.ts"],
  /**
   * Runs after Jest is installed; use for `afterEach` / `jest` APIs.
   * @see https://jestjs.io/docs/configuration#setupfilesafterenv-array
   */
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup/afterEach.ts"],
  passWithNoTests: true,
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/__tests__/**"
  ],
  moduleNameMapper: {
    "^@famlink/db$": "<rootDir>/../../packages/db/src/index.ts",
    "^@famlink/shared$": "<rootDir>/../../packages/shared/src/index.ts"
  }
};

export default config;
