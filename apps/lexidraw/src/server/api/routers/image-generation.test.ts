import { expect, mock, test } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { imageRouter } = await import("./image");
test("authenticated legacy image route is closed regardless of shared keys or policy; no provider request", async () => {
  const caller = imageRouter.createCaller({
    drizzle: db,
    schema: {},
    session: { user: { id: "image-tester" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  expect(await caller.getAiGenerationStatus()).toMatchObject({
    isConfigured: false,
  });
  await expect(caller.generateAiImage({ prompt: "a tree" })).rejects.toThrow(
    "Image generation is unavailable",
  );
});
