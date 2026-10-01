import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer";

const root = new URL("../", import.meta.url);
const fixture = JSON.parse(
  readFileSync(
    new URL("scripts/fixtures/article-reading-order.json", root),
    "utf8",
  ),
);
const route = readFileSync(
  new URL("src/app/api/render/embed/route.ts", root),
  "utf8",
);
// Run the same browser callback the worker uses, including the original inline
// form so the retained probe can reproduce the pre-fix failure at its base SHA.
let callback: string;
if (route.includes("page.evaluate(extractArticleInteractions")) {
  callback = readFileSync(
    new URL("src/lib/article-interactions.ts", root),
    "utf8",
  ).replace("export function", "function");
} else {
  const start =
    route.indexOf("const interactions = await page.evaluate(() => {") +
    "const interactions = await page.evaluate(".length;
  const end = route.indexOf("\n    });", start);
  assert(start > 0 && end > start, "worker callback shape changed");
  callback = `const extractArticleInteractions = ${route.slice(start, end)}\n};`;
}
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(
  `${callback}\nextractArticleInteractions();`,
);
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(fixture.html);
  const result = await page.evaluate(
    `(()=>{${javascript.replace(/extractArticleInteractions\(\);\s*$/, "return extractArticleInteractions(true);")}})()`,
  );
  assert.deepEqual(
    result.accessibility.map((item: { role: string; text: string }) => [
      item.role,
      item.text,
    ]),
    fixture.expected,
  );
  assert.equal(
    result.accessibility.filter(
      (item: { role: string }) => item.role === "link",
    ).length,
    fixture.expected.filter((item: [string, string]) => item[0] === "link")
      .length,
  );
  assert.equal(
    result.accessibility.find((item: { role: string }) => item.role === "link")
      .url,
    "https://example.com/more",
  );
  assert(
    result.accessibility.every(
      (item: { width: number; height: number }) =>
        item.width > 0 && item.height > 0,
    ),
  );
  assert.equal(
    result.accessibility.find(
      (item: { text: string }) => item.text === "Linked heading",
    ).heading,
    true,
    "Linked headings retain heading navigation",
  );
  const legacy = await page.evaluate(
    `(()=>{${javascript.replace(/extractArticleInteractions\(\);\s*$/, "return extractArticleInteractions(false);")}})()`,
  );
  assert.equal(
    "accessibility" in legacy,
    false,
    "Legacy native decoders must not receive new metadata without opting in",
  );
  console.log(
    "Actual Chromium article reading order, link URL and Range geometry passed",
  );
} finally {
  await browser.close();
}
