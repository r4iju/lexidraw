/// <reference types="bun" />
import { afterAll, beforeEach, expect, test } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";

await installServerRuntime();
const { captureBlock } = await import("./preview");
const { savedBlock } = await import("./content");

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const block = savedBlock({ html: "<p>Hi</p>", description: "Greeting" });

/** What the worker answers next, in order, and what it was sent. */
let answers: (() => Response)[] = [];
const asked: unknown[] = [];
const worker = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    asked.push(await request.json());
    return (answers.shift() ?? (() => new Response(PNG_BYTES)))();
  },
});
const base = `http://127.0.0.1:${worker.port}`;
afterAll(() => worker.stop(true));
beforeEach(() => {
  answers = [];
  asked.length = 0;
});

test("the worker is asked for the reader's theme and width", async () => {
  await captureBlock(block, { width: 358, theme: "dark" }, { worker: base });

  expect(asked).toEqual([
    expect.objectContaining({ width: 358, theme: "dark" }),
  ]);
});

test("a busy worker is asked again until it has a turn", async () => {
  const busy = () =>
    new Response("Preview renderer is busy", {
      status: 503,
      headers: { "retry-after": "0" },
    });
  answers = [busy, busy];

  const data = await captureBlock(
    block,
    { width: 800, theme: "light" },
    { worker: base },
  );

  expect(data).toBe(Buffer.from(PNG_BYTES).toString("base64"));
  expect(asked).toHaveLength(3);
});

test("a script error reaches the reader in the block's own words", async () => {
  answers = [() => Response.json({ message: "boom" }, { status: 422 })];

  const failure = captureBlock(
    block,
    { width: 800, theme: "light" },
    { worker: base },
  );

  expect(failure).rejects.toThrow("boom");
});
