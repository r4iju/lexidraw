/// <reference types="bun" />
/**
 * Records what web Excalidraw draws for each scene in `scenes.ts`, into the
 * fixtures `DrawingKitTests` checks the iOS renderer against:
 *
 *   Tests/DrawingKitTests/Fixtures/Drawings/<scene>/
 *     scene.json          the canonical elements the scene converts to
 *     <theme>.events.json every canvas call the export made
 *     <theme>.png         the export itself, at scale 2
 *     files/<fileId>.png  the images the scene shows, if any
 *
 * and what the web editor does with each script in `interactions.ts`:
 *
 *   Tests/DrawingKitTests/Fixtures/Interactions/<script>/
 *     script.json         the steps, and the elements they start from
 *     after.json          every element the editor ends with, deleted ones too
 *     files/<name>.png    the images the steps drop, if any
 *
 * Run with `bun run record:drawings` after bumping `@excalidraw/excalidraw`;
 * it needs Playwright's Chromium (`bunx playwright install chromium`). The
 * page is served from here with the editor's own fonts, and every other
 * request is refused, so a recording never depends on a CDN.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, type Page } from "playwright";

import { INTERACTIONS, type Step, type Style } from "./interactions.js";
import { SCENES } from "./scenes.js";

const SHORTCUTS: Record<string, string> = {
  undo: "ControlOrMeta+z",
  redo: "ControlOrMeta+Shift+z",
  group: "ControlOrMeta+g",
  ungroup: "ControlOrMeta+Shift+G",
};

/** The control in the editor's style panel that sets `style` to `value`. */
function styleControl(style: Style, value: string | number) {
  switch (style) {
    case "strokeColor":
    case "backgroundColor":
      return `[data-testid="color-top-pick-${value}"]`;
    case "fillStyle":
      return `[data-testid="fill-${value}"]`;
    case "strokeWidth":
      return `label:has([data-testid="strokeWidth-${{ 1: "thin", 2: "bold", 4: "extraBold" }[value]}"])`;
    case "roughness":
      return `label[title="${{ 0: "Architect", 1: "Artist", 2: "Cartoonist" }[value]}"]`;
  }
}

const here = import.meta.dir;
const tests = join(here, "..", "..", "Tests", "DrawingKitTests", "Fixtures");
const fixtures = join(tests, "Drawings");
const interactionFixtures = join(tests, "Interactions");
const editor = dirname(
  Bun.resolveSync("@excalidraw/excalidraw/package.json", here),
);
const fontsDirectory = join(editor, "dist", "prod", "fonts");

const build = await Bun.build({
  entrypoints: [join(here, "page.ts"), join(here, "editor.ts")],
  target: "browser",
  format: "esm",
  conditions: ["production"],
  // Merging modules renames clashing names, and Bun's picks can clash with
  // the short names the editor's own minified build already uses, which
  // breaks binding an arrow's end; minifying names afresh avoids both.
  minify: { identifiers: true },
  define: { "process.env.NODE_ENV": '"production"' },
});
for (const message of build.logs) console.error(String(message));
if (!build.success) process.exit(1);
const outputs = new Map<string, string>(
  await Promise.all(
    build.outputs.map(
      async (output) =>
        [`/${output.path.replace(/^\.\//, "")}`, await output.text()] as const,
    ),
  ),
);
const html = (script: string, style = "") =>
  new Response(
    `<!doctype html><meta charset="utf-8">${style && `<link rel="stylesheet" href="${style}">`}<body><script type="module" src="${script}"></script></body>`,
    { headers: { "content-type": "text/html" } },
  );

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/") return html("/page.js");
    if (pathname === "/editor") return html("/editor.js", "/editor.css");
    const output = outputs.get(pathname);
    if (output !== undefined) {
      return new Response(output, {
        headers: {
          "content-type": pathname.endsWith(".css")
            ? "text/css"
            : "text/javascript",
        },
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
  // With touch, the editor takes itself to be on an iPad, and lays out its
  // handles as it does there.
  const page = await browser.newPage({ deviceScaleFactor: 1, hasTouch: true });
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
    const files = await page.evaluate(
      (files) => window.drawFiles(files),
      scene.files ?? {},
    );
    for (const [id, dataURL] of Object.entries(files)) {
      await mkdir(join(directory, "files"), { recursive: true });
      await writeFile(join(directory, "files", `${id}.png`), pngBytes(dataURL));
    }
    for (const theme of ["light", "dark"] as const) {
      const result = await page.evaluate(
        ([elements, theme, files]) => window.record(elements, theme, files),
        [elements, theme, files] as const,
      );
      await writeFile(
        join(directory, `${theme}.events.json`),
        JSON.stringify(result.events),
      );
      await writeFile(join(directory, `${theme}.png`), pngBytes(result.png));
    }
    console.log(scene.name);
  }

  await rm(interactionFixtures, { recursive: true, force: true });
  for (const interaction of INTERACTIONS) {
    const directory = join(interactionFixtures, interaction.name);
    await mkdir(directory, { recursive: true });
    await page.goto(server.url.href);
    await page.waitForFunction(() => typeof window.convert === "function");
    const before = interaction.before
      ? await page.evaluate(
          (skeleton) => window.convert(skeleton),
          interaction.before,
        )
      : [];
    await page.goto(new URL("/editor", server.url).href);
    await page.waitForFunction(() => typeof window.play === "function");
    await page.evaluate((elements) => window.load(elements), before);
    const files = await page.evaluate(
      (files) => window.useFiles(files),
      interaction.files ?? {},
    );
    for (const [id, dataURL] of Object.entries(files)) {
      await mkdir(join(directory, "files"), { recursive: true });
      await writeFile(join(directory, "files", `${id}.png`), pngBytes(dataURL));
    }
    for (const step of interaction.steps) await play(page, step);
    await writeFile(
      join(directory, "script.json"),
      `${JSON.stringify({ before, steps: interaction.steps }, null, 2)}\n`,
    );
    await writeFile(
      join(directory, "after.json"),
      `${JSON.stringify(
        await page.evaluate(() => window.elements()),
        null,
        2,
      )}\n`,
    );
    console.log(interaction.name);
  }
} finally {
  await browser.close();
  server.stop();
}

/** Keys and typing go through Playwright's keyboard, as a person's do. */
async function play(page: Page, step: Step) {
  if ("type" in step) {
    await page.keyboard.type(step.type);
  } else if ("press" in step) {
    await page.keyboard.press(SHORTCUTS[step.press] ?? step.press);
  } else if ("style" in step) {
    await page.locator(styleControl(step.style, step.value)).click();
  } else {
    await page.evaluate((step) => window.play(step), step);
    return;
  }
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

function pngBytes(dataURL: string): Buffer {
  return Buffer.from(dataURL.replace(/^data:image\/png;base64,/, ""), "base64");
}
