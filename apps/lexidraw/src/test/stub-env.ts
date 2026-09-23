// Preloaded into child processes that import the server router outside Next:
// the router's import graph reaches `server-only` and the validated env, and
// neither has any bearing on the shape of a generated document.
import { mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@packages/env", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, key) => (key === "NODE_ENV" ? "test" : "https://example.test"),
    },
  ),
}));
