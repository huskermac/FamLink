import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/tests/**/*.test.ts"],
  globalSetup: "<rootDir>/src/tests/setup/globalSetup.ts",
  globalTeardown: "<rootDir>/src/tests/setup/globalTeardown.ts",
  setupFilesAfterEnv: [
    "<rootDir>/src/tests/setup/loadTestEnv.ts",
    "<rootDir>/src/tests/setup/afterEach.ts"
  ],
  passWithNoTests: true,
  coverageDirectory: "coverage",
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/tests/**"
  ],
  moduleNameMapper: {
    "^@famlink/db$": "<rootDir>/../../packages/db/src/index.ts",
    "^@famlink/shared$": "<rootDir>/../../packages/shared/src/index.ts"
  }
};

export default config;
