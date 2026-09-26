import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { POST as renderHtml } from "./render-html/route";
import { POST as renderPdf } from "./render/pdf/route";
import { POST as screenshot } from "./screenshot/route";

const SECRET = "shared-with-the-app";
/** What the machine's own service was asked for. */
const asked: string[] = [];
let app: ReturnType<typeof Bun.serve>;
/** The app's own origin in development, which the worker is told to allow. */
let appOrigin: string;
const env = process.env as Record<string, string | undefined>;

beforeAll(() => {
  app = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      asked.push(new URL(request.url).pathname);
      return new Response(
        `<link rel="icon" href="data:,">
        <img src="http://127.0.0.1:${app.port}/inside.png">
        <article id="lexical-content-doc">A document</article>
        <script>window.__readyForPdf__ = true</script>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  appOrigin = `http://localhost:${app.port}`;
  env.RENDER_WORKER_SECRET = SECRET;
  env.RENDER_WORKER_ALLOWED_ORIGINS = `https://lexidraw.test, ${appOrigin}`;
});
afterAll(() => {
  app.stop(true);
  delete env.RENDER_WORKER_SECRET;
  delete env.RENDER_WORKER_ALLOWED_ORIGINS;
});

const ROUTES = [
  ["render-html", renderHtml],
  ["render/pdf", renderPdf],
  ["screenshot", screenshot],
] as const;

function call(
  route: (request: NextRequest) => Promise<Response>,
  body: object,
  authorization?: string,
) {
  asked.length = 0;
  return route(
    new NextRequest("https://worker.test/api", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe.each(ROUTES)("/api/%s", (_, route) => {
  test.each([undefined, "Bearer not-the-secret", SECRET])(
    "does nothing for a caller who doesn't send the app's secret (%p)",
    async (authorization) => {
      const answer = await call(route, { url: appOrigin }, authorization);

      expect(answer.status).toBe(401);
      expect(asked).toEqual([]);
    },
  );

  test.each([
    "http://127.0.0.1:9/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:9/",
  ])("refuses an address inside (%s)", async (url) => {
    const answer = await call(route, { url }, `Bearer ${SECRET}`);

    expect(answer.status).toBe(400);
  });
});

test("the app's own origin, when allowed, is rendered, and nothing else inside it", async () => {
  const answer = await call(
    screenshot,
    {
      url: `${appOrigin}/screenshot/view/doc`,
      viewport: { width: 400, height: 300 },
      waitForDocument: true,
      waitUntil: "load",
    },
    `Bearer ${SECRET}`,
  );

  expect(answer.status).toBe(200);
  expect(answer.headers.get("content-type")).toBe("image/png");
  expect(asked).toEqual(["/screenshot/view/doc"]);
}, 30_000);

test("another port on the app's host is no longer the app's origin", async () => {
  const answer = await call(
    renderPdf,
    { url: `http://127.0.0.1:${app.port}/` },
    `Bearer ${SECRET}`,
  );

  expect(answer.status).toBe(400);
  expect(asked).toEqual([]);
});
