// @ts-check

import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import hooksPlugin from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/** @type {import("typescript-eslint").Config} */
export default tseslint.config({
  plugins: {
    "@typescript-eslint": tseslint.plugin,
    react: reactPlugin,
    "react-hooks": hooksPlugin,
    "@next/next": nextPlugin,
  },
  files: ["**/*.ts", "**/*.tsx"],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: true,
    },
  },
  rules: {
    ...reactPlugin.configs["jsx-runtime"].rules,
    ...hooksPlugin.configs.recommended.rules,
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs["core-web-vitals"].rules,
    "@next/next/no-img-element": "error",
    "@next/next/no-sync-scripts": "error",
    "@typescript-eslint/no-unsafe-argument": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
  },
});
