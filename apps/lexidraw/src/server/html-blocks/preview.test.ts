/// <reference types="bun" />
import { afterAll, beforeEach, expect, test } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";

await installServerRuntime();
const { captureBlock } = await import("./preview");
const { savedBlock } = await import("./content");

/** The start of a PNG: its signature and the IHDR chunk naming its size. */
function png(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
const block = savedBlock({ html: "<p>Hi</p>", description: "Greeting" });

/** A capture at twice the requested width, as the worker takes them. */
const PREVIEW = png(1600, 720);
/** What the worker answers next, in order, and what it was sent. */
let answers: (() => Response)[] = [];
const asked: unknown[] = [];
const worker = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    asked.push(await request.json());
    return (answers.shift() ?? (() => new Response(PREVIEW)))();
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

  const preview = await captureBlock(
    block,
    { width: 800, theme: "light" },
    { worker: base },
  );

  expect(preview).toMatchObject({
    status: "ready",
    data: PREVIEW.toString("base64"),
  });
  expect(asked).toHaveLength(3);
});

test("a script error reaches the reader in the block's own words", async () => {
  answers = [() => Response.json({ message: "boom" }, { status: 422 })];

  const preview = await captureBlock(
    block,
    { width: 800, theme: "light" },
    { worker: base },
  );

  expect(preview).toEqual({
    status: "failed",
    reason: "script",
    message: "boom",
  });
});

test("a renderer that cannot be reached is not blamed on the block", async () => {
  const closed = Bun.serve({ port: 0, fetch: () => new Response() });
  const gone = `http://127.0.0.1:${closed.port}`;
  closed.stop(true);

  const preview = await captureBlock(
    block,
    { width: 800, theme: "light" },
    { worker: gone },
  );

  expect(preview).toMatchObject({ status: "failed", reason: "unavailable" });
});

test("a worker that stays busy never shows the reader that it is busy", async () => {
  const busy = () =>
    new Response("Preview renderer is busy", {
      status: 503,
      headers: { "retry-after": "0" },
    });
  answers = Array.from({ length: 10 }, () => busy);

  const preview = await captureBlock(
    block,
    { width: 800, theme: "light" },
    { worker: base },
  );

  expect(preview).toMatchObject({ status: "failed", reason: "unavailable" });
  expect(JSON.stringify(preview)).not.toContain("busy");
});

test("a preview says how many image pixels make one layout pixel", async () => {
  answers = [() => new Response(png(716, 360))];

  const preview = await captureBlock(
    block,
    { width: 358, theme: "light" },
    { worker: base },
  );

  expect(preview).toMatchObject({ status: "ready", scale: 2 });
});
