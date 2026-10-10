import { expect, mock } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
await installServerRuntime();
mock.module("~/server/auth", () => ({
  auth: () => ({
    user: { id: "alice", config: { autocomplete: { enabled: true } } },
  }),
}));
globalThis.fetch = Object.assign(
  async () => {
    throw new Error("Unexpected network");
  },
  { preconnect() {} },
);
mock.module("~/server/llm/get-effective-config", () => ({
  getEffectiveLlmConfig: async () => ({
    provider: "openai",
    modelId: "unverified",
    maxOutputTokens: 64,
    temperature: 0,
  }),
}));
const { POST } = await import("./route");
const response = await POST(
  new Request("http://localhost/api/autocomplete/stream", {
    method: "POST",
    body: JSON.stringify({ before: "hello", apiKey: "sk-or-v1-test-only" }),
  }) as never,
);
expect(response.status).toBe(410);
expect(await response.text()).toContain("AI power");
console.log("legacy autocomplete system-key route is closed");
