import { expect, test, mock } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { llmRouter } = await import("../api/routers/llm");
const { webRouter } = await import("../api/routers/web");
const { sandboxRouter } = await import("../api/routers/sandbox");
const ctx = {
  drizzle: db,
  session: {
    user: {
      id: "admin",
      role: "admin",
      config: { llm: { agent: { provider: "openai" } } },
    },
    expires: "2099",
  },
  headers: new Headers(),
};
test("legacy direct planner/generation/search do not accept operation IDs as system-key authorization", async () => {
  const prior = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      throw new Error("External request blocked");
    },
    { preconnect: () => {} },
  );
  try {
    await expect(
      llmRouter
        .createCaller(ctx as never)
        .plan({ prompt: "write", availableTools: ["insertTextNode"], max: 1 }),
    ).rejects.toThrow("bounded");
    await expect(
      llmRouter
        .createCaller(ctx as never)
        .generate({ prompt: "write", mode: "agent" }),
    ).rejects.toThrow("bounded");
    await expect(
      webRouter.createCaller(ctx as never).googleSearch({ query: "tree" }),
    ).rejects.toThrow("parent");
    await expect(
      sandboxRouter
        .createCaller({
          ...ctx,
          headers: new Headers({ "x-pro-operation-id": "forged" }),
        } as never)
        .search({ query: "tree" }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = prior;
  }
});
