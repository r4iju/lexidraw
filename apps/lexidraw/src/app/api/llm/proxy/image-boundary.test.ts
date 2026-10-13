import { expect, mock, test } from "bun:test";
mock.module("~/server/auth", () => ({
  auth: async () => ({ user: { id: "fixture" } }),
}));
mock.module("@packages/env", () => ({
  default: { OPENAI_API_KEY: undefined, GOOGLE_API_KEY: undefined },
}));
test("legacy server-key proxies reject image paths before key lookup or any provider work", async () => {
  for (const [module, path] of [
    ["./openai/[...path]/route", ["images", "generations"]],
    [
      "./google/[...path]/route",
      ["v1beta", "models", "gemini-image:generateContent"],
    ],
  ] as const) {
    const route = await import(module);
    const response = await route.POST(
      new Request("http://localhost/api/llm/proxy", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ path: [...path] }) },
    );
    expect(response.status).toBe(410);
  }
});

test("legacy provider reads cannot retrieve unowned narration or restart paid audio work before key lookup", async () => {
  for (const [module, path] of [
    ["./openai/[...path]/route", ["audio", "speech"]],
    ["./google/[...path]/route", ["v1beta", "interactions", "unowned"]],
    ["./google/[...path]/route", ["v1beta", "operations", "unowned"]],
    [
      "./google/[...path]/route",
      ["v1beta", "models", "gemini-3.8-flash-lite-tts"],
    ],
  ] as const) {
    const route = await import(module);
    const response = await route.GET(
      new Request("http://localhost/api/llm/proxy"),
      { params: Promise.resolve({ path: [...path] }) },
    );
    expect(response.status).toBe(410);
  }
});
