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
