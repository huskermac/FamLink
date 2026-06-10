// Root ESLint 9 flat config — found by upward lookup when turbo runs `eslint` in each workspace.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/node_modules/**",
      "packages/db/src/generated/**",
      "packages/db/apps/**",
      ".claude/**"
    ]
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Existing code uses `any` at third-party boundaries; surface as warnings, not failures.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  }
);
