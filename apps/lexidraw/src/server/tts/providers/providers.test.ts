import { expect, test, mock } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
await installServerRuntime();
mock.module("@packages/env", () => ({
  default: { OPENAI_API_KEY: "fixture-only", GOOGLE_API_KEY: "fixture-only" },
}));
const { createOpenAiTtsProvider } = await import("./openai");
const { createGeminiTtsProvider } = await import("./gemini");
const { createKokoroTtsProvider } = await import("./kokoro");
test("direct legacy speech helpers cannot accept provider keys or start synthesis outside the power boundary", () => {
  for (const create of [
    createOpenAiTtsProvider,
    createGeminiTtsProvider,
    createKokoroTtsProvider,
  ]) {
    expect(() => create("fixture-never-send")).toThrow("unavailable");
  }
});
