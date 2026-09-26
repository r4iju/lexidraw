/// <reference types="bun" />
/**
 * Records what web Excalidraw draws for each scene in `scenes.ts`, into the
 * fixtures `DrawingKitTests` checks the iOS renderer against:
 *
 *   Tests/DrawingKitTests/Fixtures/Drawings/<scene>/
 *     scene.json          the canonical elements the scene converts to
 *     <theme>.events.json every canvas call the export made
 *     <theme>.png         the export itself, at scale 2
 *
 * Run with `bun run record:drawings` after bumping `@excalidraw/excalidraw`;
 * it needs Playwright's Chromium (`bunx playwright install chromium`). The
 * page is served from here with the editor's own fonts, and every other
 * request is refused, so a recording never depends on a CDN.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium } from "playwright";

import { SCENES } from "./scenes.js";

const here = import.meta.dir;
const fixtures = join(
  here,
  "..",
  "..",
  "Tests",
  "DrawingKitTests",
  "Fixtures",
  "Drawings",
);
const editor = dirname(
  Bun.resolveSync("@excalidraw/excalidraw/package.json", here),
);
const fontsDirectory = join(editor, "dist", "prod", "fonts");

const build = await Bun.build({
  entrypoints: [join(here, "page.ts")],
  target: "browser",
  format: "esm",
  conditions: ["production"],
  define: { "process.env.NODE_ENV": '"production"' },
});
for (const message of build.logs) console.error(String(message));
const script = build.outputs.find((output) => output.path.endsWith(".js"));
if (!build.success || !script) process.exit(1);
const bundle = await script.text();

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/") {
      return new Response(
        '<!doctype html><meta charset="utf-8"><body><script type="module" src="/page.js"></script></body>',
        { headers: { "content-type": "text/html" } },
      );
    }
    if (pathname === "/page.js") {
      return new Response(bundle, {
        headers: { "content-type": "text/javascript" },
      });
    }
    if (pathname.startsWith("/fonts/")) {
      const file = Bun.file(join(fontsDirectory, pathname.slice(7)));
      if (await file.exists()) return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route("**/*", (route) =>
    route.request().url().startsWith(server.url.origin)
      ? route.continue()
      : route.abort(),
  );
  page.on("pageerror", (error) => console.error(error));
  await page.goto(server.url.href);
  await page.waitForFunction(() => typeof window.record === "function");

  await rm(fixtures, { recursive: true, force: true });
  for (const scene of SCENES) {
    const directory = join(fixtures, scene.name);
    await mkdir(directory, { recursive: true });
    const elements = await page.evaluate(
      (skeleton) => window.convert(skeleton),
      scene.elements,
    );
    await writeFile(
      join(directory, "scene.json"),
      `${JSON.stringify(elements, null, 2)}\n`,
    );
    for (const theme of ["light", "dark"] as const) {
      const result = await page.evaluate(
        ([elements, theme]) => window.record(elements, theme),
        [elements, theme] as const,
      );
      await writeFile(
        join(directory, `${theme}.events.json`),
        JSON.stringify(result.events),
      );
      await writeFile(
        join(directory, `${theme}.png`),
        Buffer.from(
          result.png.replace(/^data:image\/png;base64,/, ""),
          "base64",
        ),
      );
    }
    console.log(scene.name);
  }
} finally {
  await browser.close();
  server.stop();
}
