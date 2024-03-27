// @ts-check

import tseslint from "typescript-eslint";

/** @type {import("typescript-eslint").Config} */
export default tseslint.config({
  plugins: {
    "@typescript-eslint": tseslint.plugin,
  },
  files: ["**/*.ts", "**/*.tsx"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: true,
    },
  },
  rules: {
    "@typescript-eslint/no-unsafe-argument": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
  },
  ignores: ["**/node_modules/**", "**/dist/**"],
});
