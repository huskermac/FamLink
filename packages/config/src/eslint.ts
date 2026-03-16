import type { Linter } from "eslint";

export const baseEslintConfig: Linter.Config = {
  ignores: ["dist", ".turbo"],
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module"
  },
  rules: {
    "no-unused-vars": "warn",
    "no-undef": "error"
  }
};

