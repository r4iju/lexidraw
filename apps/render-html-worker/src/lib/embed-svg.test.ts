import { afterAll, beforeAll, expect, test } from "bun:test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import puppeteer, { type Browser } from "puppeteer";
import { serializeEmbedSVG } from "./embed-svg";

let browser: Browser;
beforeAll(async () => {
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
});

// Shaped like the native render page: a themed document root defining a few
// hundred custom properties, and a 99-line syntax-highlighted code block.
function highlightedCodePage() {
  const variables = Array.from(
    { length: 271 },
    (_, i) => `--theme-token-${i}: oklch(0.${i % 10} 0.1 ${i});`,
  ).join("");
  const colors = ["#F97583", "#B392F0", "#9ECBFF", "#E1E4E8", "#79B8FF"];
  const lines = Array.from({ length: 99 }, (_, line) =>
    Array.from(
      { length: 8 },
      (_, token) =>
        `<span style="color:${colors[(line + token) % colors.length]}">tok${line}_${token} </span>`,
    ).join(""),
  ).join("<br>");
  return `<!doctype html><html><head><style>
    :root { ${variables} }
    body { margin: 0; background: #111; color: #eee; font: 15px sans-serif; }
    .code-block { display: block; padding: 8px; background: #24292e; font-family: monospace; line-height: 1.5; white-space: pre; border-radius: 6px; }
  </style></head><body><article id="native-embed" style="width: 700px"><code class="code-block">${lines}</code></article></body></html>`;
}

test("a long highlighted code block serializes within the 8 MB SVG contract and draws like the page", async () => {
  const page = await browser.newPage();
  await page.setViewport({ width: 760, height: 2600 });
  await page.setContent(highlightedCodePage());
  const svg = await page.evaluate(serializeEmbedSVG);
  expect(svg.length).toBeLessThan(8_000_000);

  const element = await page.$("#native-embed");
  const box = await element?.boundingBox();
  if (!element || !box) throw new Error("No render root");
  const live = PNG.sync.read(
    Buffer.from(await element.screenshot({ type: "png" })),
  );
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#111"><img id="svg" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`,
  );
  await page.waitForFunction(() => {
    const image = document.getElementById("svg");
    return image instanceof HTMLImageElement && image.complete;
  });
  const drawn = PNG.sync.read(
    Buffer.from(
      await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: live.width, height: live.height },
      }),
    ),
  );
  const changed = pixelmatch(
    live.data,
    drawn.data,
    undefined,
    live.width,
    live.height,
    { threshold: 0.1 },
  );
  expect(changed / (live.width * live.height)).toBeLessThan(0.01);
  await page.close();
}, 60000);

test("author styles that equal a browser default in another context stay in the SVG", async () => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><style>
    :root { --block: block; --indent: 40px; }
    .prose ul { list-style-type: disc; }
    .prose li { padding-left: 40px; }
  </style></head><body><article id="native-embed" class="prose"><div style="display: var(--block)">Lead</div><ul><li>Outer<ul style="padding: 0 0 0 var(--indent)"><li>Inner</li></ul></li></ul></article></body></html>`);
  const svg = await page.evaluate(serializeEmbedSVG);
  await page.setContent(`<!doctype html><html><body>${svg}</body></html>`);
  const drawn = await page.evaluate(() => {
    const root = document.querySelector("foreignObject > *");
    const lead = root?.querySelector("div");
    const inner = root?.querySelector("ul ul");
    if (!lead || !inner) throw new Error("No serialized embed");
    return {
      lead: getComputedStyle(lead).display,
      innerList: getComputedStyle(inner).listStyleType,
      innerIndent: getComputedStyle(inner).paddingLeft,
    };
  });
  expect(drawn).toEqual({
    lead: "block",
    innerList: "disc",
    innerIndent: "40px",
  });
  await page.close();
});
