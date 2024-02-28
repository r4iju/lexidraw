/** @type {import("eslint").Linter.Config} */
const config = {
  extends: ["../../.eslintrc.cjs"],
  parserOptions: {
    ecmaVersion: 2023,
    sourceType: true,
  },
};

module.exports = config;
