import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./test-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { lines: 80 }
    },
    include: [
      "lib/**/__tests__/**/*.test.tsx",
      "lib/**/__tests__/**/*.test.ts",
      "app/**/__tests__/**/*.test.tsx",
      "app/**/__tests__/**/*.test.ts",
      "components/**/__tests__/**/*.test.tsx",
      "components/**/__tests__/**/*.test.ts",
      "hooks/**/__tests__/**/*.test.tsx",
      "hooks/**/__tests__/**/*.test.ts"
    ],
    passWithNoTests: true
  }
});
