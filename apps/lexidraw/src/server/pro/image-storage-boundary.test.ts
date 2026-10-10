import { expect, test, mock } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
await installServerRuntime();
mock.module("server-only", () => ({}));
mock.module("./runtime", () => ({ proLedger: () => ({ client: {} }) }));
mock.module("@packages/env", () => ({ default: {} }));
const { generatedImages } = await import("./image-runtime");
test("production generated images require a dedicated private store configuration", () => {
  expect(() => generatedImages()).toThrow(
    "Private image storage is not configured",
  );
});
