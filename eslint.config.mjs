import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactPlugin from "eslint-plugin-react";
import hooksPlugin from "eslint-plugin-react-hooks";
import compilerPlugin from "eslint-plugin-react-compiler";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  // react compiler - is it even working?
  {
    plugins: {
      "react-compiler": compilerPlugin,
    },
    // rules: {
    //   ...compilerPlugin.rules,
    // },
  },
  // typescript
  {
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  // react
  {
    plugins: {
      react: reactPlugin,
    },
    rules: reactPlugin.configs["jsx-runtime"].rules,
    settings: {
      react: {
        version: "detect", // You can add this if you get a warning about the React version when you lint
      },
    },
  },
  // react hooks
  {
    plugins: {
      "react-hooks": hooksPlugin,
    },
    rules: hooksPlugin.configs.recommended.rules,
  },
  // next.js
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  // ignore files
  {
    ignores: [
      ".next/*",
      "coverage/*",
      "postcss.config.cjs",
      "tailwind.config.cjs",
      "drizzle.config.ts",
      "migrate.ts",
      "**/dist/**/*",
    ],
  },
);
