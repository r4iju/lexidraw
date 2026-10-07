import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";
const fixture = JSON.parse(
  readFileSync(
    new URL("fixtures/article-images.json", import.meta.url),
    "utf8",
  ),
);
const source = readFileSync(
  new URL("../src/lib/article-interactions.ts", import.meta.url),
  "utf8",
).replace("export function", "function");
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
  source + "\nextractArticleInteractions();",
);
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(fixture.html);
  await page.evaluate(() =>
    Promise.all([...document.images].map((i) => i.decode())),
  );
  const modern = await page.evaluate(
    `(()=>{${js.replace(/extractArticleInteractions\(\);\s*$/, "return extractArticleInteractions(true, true);")}})()`,
  );
  assert.equal(
    modern.articleImages?.length,
    2,
    "Article image metadata must preserve visible images",
  );
  assert.equal(modern.articleImages[0].alt, "Disposable colored frame");
  assert.equal(modern.articleImages[0].textIndex, 1);
  assert.equal(
    modern.articleImages[0].overlay,
    true,
    "Default replaced-image clipping is faithfully supported",
  );
  assert.equal(modern.articleImages[0].width, 64);
  assert.equal(modern.articleImages[0].height, 48);
  assert.equal(modern.articleImages[1].alt, "");
  await page.evaluate(() => {
    const image = document.images[0];
    const text = document.createElement("span");
    text.textContent = "Later overlapping text";
    const rect = image.getBoundingClientRect();
    text.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px`;
    image.parentElement!.append(text);
  });
  const overlapping = await page.evaluate(
    `(()=>{${js.replace(/extractArticleInteractions\(\);\s*$/, "return extractArticleInteractions(true, true);")}})()`,
  );
  assert.equal(overlapping.articleImages[0].overlay, false,
    "Later positioned text must retain raster stacking");
  const legacy = await page.evaluate(
    `(()=>{${js.replace(/extractArticleInteractions\(\);\s*$/, "return extractArticleInteractions(true);")}})()`,
  );
  assert.equal(
    "articleImages" in legacy,
    false,
    "Existing AX clients retain known response shape",
  );
  console.log(
    "Actual Chromium image alt, reading order, geometry and capability passed",
  );
} finally {
  await browser.close();
}
