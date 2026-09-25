import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import puppeteer from "puppeteer";
import { appUrl } from "./app-url";
import { checkRichBlocks } from "./check-rich-blocks";
import { checkFrame } from "./check-frame";
import { checkFirstPaint } from "./check-first-paint";
import { BANNER, checkReservedSizes } from "./check-reserved-sizes";
import { checkMedia } from "./check-media";
import { checkPage } from "./check-page";
import { checkTables } from "./check-tables";
import { checkEditorControls } from "./check-editor-controls";
import { checkOverlays } from "./check-overlays";
import { checkTokens } from "./check-tokens";
import { checkTypography, checkDocumentSettings } from "./check-typography";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const here = fileURLToPath(new URL("./", import.meta.url));
const output = resolve(root, ".playwright-mcp/document-snapshots");
const fixtureId =
  process.env.VISUAL_FIXTURE_ID ?? "98683bf7-3f2c-4c60-acd3-a82f24f805ad";
const update = process.argv.includes("--update");
// Phones and tablets under a finger, whose targets grow to 44px.
const touch = process.argv.includes("--touch");
if (process.env.CI)
  throw new Error(
    "Visual snapshots require the local dev stack; do not run in CI",
  );
await mkdir(output, { recursive: true });

async function cli(...args: string[]) {
  const child = Bun.spawn(
    ["bun", resolve(root, "apps/cli/src/main.ts"), "--profile", "dev", ...args],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      // Never let a shell override redirect this suite to production.
      env: {
        ...process.env,
        LEXIDRAW_URL: appUrl,
        LEXIDRAW_TOKEN: undefined,
      },
    },
  );
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (status) throw new Error(stderr);
  return JSON.parse(stdout);
}

// Rebuild from source every run, so changing a fixture is enough to test it.
const markdown = (
  await readFile(resolve(here, "fixtures/kitchen-sink.md"), "utf8")
).replace(/<!-- TODO[\s\S]*?-->/g, "");
const markdownPath = resolve(output, "fixture.md");
await writeFile(markdownPath, markdown);
await cli(
  "doc",
  "put",
  fixtureId,
  "--replace",
  "--file",
  markdownPath,
  "--if-unmodified-since",
  "latest",
);
const doc = await cli("doc", "get", fixtureId, "--format", "json");
const blocks = JSON.parse(
  await readFile(resolve(here, "fixtures/kitchen-sink.blocks.json"), "utf8"),
);
// The visual fixture exercises intrinsic table sizing on every run.
for (const block of doc.content.root.children) {
  if (block.type === "table") delete block.colWidths;
}
doc.content.root.children.push(...blocks);
const payload = resolve(output, "fixture.json");
await writeFile(
  payload,
  JSON.stringify({
    elements: JSON.stringify(doc.content),
    appState: JSON.stringify({ defaultFontFamily: null, lang: null }),
    ifUnmodifiedSince: doc.updatedAt,
  }),
);
await cli(
  "api",
  "PUT",
  `/entities/${fixtureId}`,
  "--json",
  await readFile(payload, "utf8"),
);

// A throwaway empty document, for what a blank page offers.
const empty = await cli("doc", "create", "--title", "Visual suite · empty");
// A throwaway document with a photo and a diagram near the top, neither
// measured yet, as a document written through the API has them.
const sized = await cli("doc", "create", "--title", "Visual suite · sizes");
const text = (value: string) => ({
  children: [
    {
      detail: 0,
      format: 0,
      mode: "normal",
      style: "",
      text: value,
      type: "text",
      version: 1,
    },
  ],
  direction: null,
  format: "",
  indent: 0,
  type: "paragraph",
  version: 1,
  textFormat: 0,
  textStyle: "",
});
const emptyRoot = {
  children: [],
  direction: null,
  format: "",
  indent: 0,
  type: "root",
  version: 1,
};
const sizedPath = resolve(output, "sized.json");
await writeFile(
  sizedPath,
  JSON.stringify({
    elements: JSON.stringify({
      root: {
        ...emptyRoot,
        children: [
          text("Before the photo."),
          {
            ...text(""),
            children: [
              {
                type: "image",
                version: 1,
                altText: "A banner",
                src: `${appUrl}${BANNER}`,
                width: 0,
                height: 0,
                maxWidth: 800,
                showCaption: false,
                caption: { editorState: { root: emptyRoot } },
              },
            ],
          },
          text("After the photo."),
          {
            type: "mermaid",
            version: 1,
            schema: "flowchart TD\n  A[One] --> B[Two] --> C[Three]",
            width: "inherit",
            height: "inherit",
          },
          text("After the diagram."),
          ...Array.from({ length: 12 }, (_, index) =>
            text(`Paragraph ${index + 1}, below the fold on a phone.`),
          ),
        ],
      },
    }),
    appState: JSON.stringify({ defaultFontFamily: null, lang: null }),
    ifUnmodifiedSince: (await cli("doc", "get", sized.id, "--format", "json"))
      .updatedAt,
  }),
);
await cli(
  "api",
  "PUT",
  `/entities/${sized.id}`,
  "--json",
  await readFile(sizedPath, "utf8"),
);
// A throwaway drawing whose one shape sits far off the first screen.
const shapesPath = resolve(output, "drawing.json");
await writeFile(
  shapesPath,
  JSON.stringify([
    {
      id: "visual-suite-far-box",
      type: "rectangle",
      x: 4000,
      y: 3000,
      width: 240,
      height: 160,
      angle: 0,
      strokeColor: "#e03131",
      backgroundColor: "#e03131",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    },
  ]),
);
const drawing = await cli(
  "drawing",
  "create",
  "--title",
  "Visual suite · drawing",
  "--file",
  shapesPath,
);

const browser = await puppeteer.launch({
  headless: true,
  userDataDir: resolve(output, "browser"),
});
try {
  const [page = await browser.newPage(), ...restored] = await browser.pages();
  for (const restoredPage of restored) await restoredPage.close();
  await checkTokens(page);
  const richPage = await browser.newPage();
  await checkRichBlocks(richPage, fixtureId, output);
  await richPage.close();
  await checkMedia(page, fixtureId, output);
  await checkTables(page, fixtureId);
  await checkTypography(page, fixtureId);
  await checkDocumentSettings(page, fixtureId);
  await checkPage(page, fixtureId, empty.id);
  await checkFrame(page, {
    fixtureId,
    emptyId: empty.id,
    drawingId: drawing.id,
  });
  await checkFirstPaint(page, {
    fixtureId,
    emptyId: empty.id,
    drawingId: drawing.id,
  });
  await checkEditorControls(page, fixtureId, output);
  await checkOverlays(page, fixtureId, output);
  await checkReservedSizes(page, { sizedId: sized.id, emptyId: empty.id });
} finally {
  await browser.close();
  await cli("doc", "delete", empty.id);
  await cli("doc", "delete", sized.id);
  await cli("drawing", "delete", drawing.id);
}

const pdfPath = resolve(output, "kitchen-sink.pdf");
await cli("doc", "render", fixtureId, "--format", "pdf", "--out", pdfPath);
const pdfText = Bun.spawn(["pdftotext", pdfPath, "-"], {
  stdout: "pipe",
  stderr: "pipe",
});
const text = await new Response(pdfText.stdout).text();
if (
  (await pdfText.exited) ||
  !text.includes("Osaka") ||
  !text.includes("3 votes total") ||
  text.includes("Skip to content")
)
  throw new Error("PDF must include the chart and poll results");

let failures = 0;
let totalBytes = 0;
const widths = touch ? [375, 768] : [375, 768, 1280];
for (const width of widths) {
  for (const theme of ["light", "dark"]) {
    const name = `${width}-${theme}${touch ? "-touch" : ""}.png`;
    const actualPath = resolve(output, name);
    await cli(
      "doc",
      "render",
      fixtureId,
      "--width",
      String(width),
      "--theme",
      theme,
      ...(touch ? ["--touch"] : []),
      "--out",
      actualPath,
    );
    // The render is as wide as the page scrolls.
    const full = PNG.sync.read(await readFile(actualPath));
    if (full.width !== width)
      throw new Error(
        `${name}: the page scrolls sideways, ${full.width}px wide at ${width}px`,
      );
    // Bound repository size while retaining the top of the reading view at 1:1.
    const actual = new PNG({ width, height: Math.min(full.height, 6000) });
    PNG.bitblt(full, actual, 0, 0, width, actual.height, 0, 0);
    const encoded = PNG.sync.write(actual);
    await writeFile(actualPath, encoded);
    const baselinePath = resolve(here, "baselines", name);
    totalBytes += encoded.length;
    if (update) {
      await writeFile(baselinePath, encoded);
      console.log(`Updated ${name} (${width}×${actual.height})`);
      continue;
    }
    let baseline: PNG;
    try {
      baseline = PNG.sync.read(await readFile(baselinePath));
    } catch {
      throw new Error(
        `Missing ${baselinePath}; review captures then run with --update`,
      );
    }
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      console.error(`${name}: dimensions changed`);
      failures++;
      continue;
    }
    const diff = new PNG({ width, height: actual.height });
    const changed = pixelmatch(
      baseline.data,
      actual.data,
      diff.data,
      width,
      actual.height,
      { threshold: 0.15 },
    );
    const ratio = changed / (width * actual.height);
    console.log(`${name}: ${(ratio * 100).toFixed(3)}% changed`);
    if (ratio > 0.005) {
      failures++;
      await writeFile(
        resolve(output, name.replace(/\.png$/, "-diff.png")),
        PNG.sync.write(diff),
      );
    }
  }
}
console.log(
  `${widths.length * 2} captures${touch ? " by touch" : ""}: ${totalBytes} bytes. Artifacts: ${output}`,
);
if (failures) throw new Error(`${failures} visual comparisons failed`);
