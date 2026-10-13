import { test, expect, mock } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
let sandboxes = 0;
mock.module("@vercel/sandbox", () => ({
  Sandbox: {
    create: async () => {
      sandboxes++;
      throw new Error("Cloud sandbox blocked by fixture");
    },
  },
}));
const db = await installServerRuntime();
const { toolsRouter } = await import("../api/routers/tools");
test("direct cloud sandbox execution cannot run under a system credential outside a parent action", async () => {
  const caller = toolsRouter.createCaller({
    drizzle: db,
    headers: new Headers(),
    session: { user: { id: "admin", role: "admin" }, expires: "2099" },
  } as never);
  await expect(
    caller.executeCode({ language: "node", code: "console.log('hello')" }),
  ).rejects.toThrow("parent");
  expect(sandboxes).toBe(0);
});
