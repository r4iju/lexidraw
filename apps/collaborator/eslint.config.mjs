/** @type {import("eslint").Linter.Config} */
const config = {
  extends: ['../../eslint.config.mjs'],
  parserOptions: {
    ecmaVersion: 2023,
    sourceType: true,
  },
};

export default config;
