/// <reference types="bun" />
import { afterAll, expect, test } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";

await installServerRuntime();
const { askRenderWorker } = await import("./render-worker");

/** What the worker was sent, read while the request is still open. */
const seen: { method: string; headers: Headers; body: unknown }[] = [];
const worker = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const { method, headers } = request;
    seen.push({ method, headers, body: await request.json() });
    return new Response("ok");
  },
});
afterAll(() => worker.stop(true));

test("the render worker is asked with the secret it shares with the app", async () => {
  await askRenderWorker(
    `http://127.0.0.1:${worker.port}/api/screenshot`,
    { url: "https://lexidraw.test/screenshot/view/doc" },
    { secret: "shared" },
  );

  const [request] = seen;
  expect(request?.method).toBe("POST");
  expect(request?.headers.get("authorization")).toBe("Bearer shared");
  expect(request?.headers.get("content-type")).toBe("application/json");
  expect(request?.body).toEqual({
    url: "https://lexidraw.test/screenshot/view/doc",
  });
});
