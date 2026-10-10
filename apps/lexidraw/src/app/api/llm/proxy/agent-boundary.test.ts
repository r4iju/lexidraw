import { expect, mock, test } from "bun:test";
mock.module("~/server/auth", () => ({
  auth: async () => ({ user: { id: "fixture" } }),
}));
mock.module("@packages/env", () => ({
  default: { OPENAI_API_KEY: undefined, GOOGLE_API_KEY: undefined },
}));
test("legacy reads cannot retrieve unowned agent provider state or honor a supplied parent ID", async () => {
  for (const [module, path] of [
    ["./openai/[...path]/route", ["responses", "unowned"]],
    ["./google/[...path]/route", ["v1beta", "cachedContents", "unowned"]],
  ] as const) {
    const route = await import(module);
    const response = await route.GET(
      new Request("http://localhost/api/llm/proxy?operationId=forged", {
        headers: { "x-pro-operation-id": "forged" },
      }),
      { params: Promise.resolve({ path: [...path] }) },
    );
    expect(response.status).toBe(410);
  }
});
