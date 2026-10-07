import puppeteer from "puppeteer";
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
const html =
  '<p>Read <strong>bold</strong> and <a href="https://example.com">link</a>.</p><ul><li>First item</li><li>Second item</li></ul>';
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    return new Response(`<article>${html}</article>`, {
      headers: { "Content-Type": "text/html" },
    });
  },
});
const browser = await puppeteer.launch({ headless: true });
try {
  const origin = `http://127.0.0.1:${server.port}`;
  await browser
    .defaultBrowserContext()
    .overridePermissions(origin, ["clipboard-read", "clipboard-write"]);
  const page = await browser.newPage();
  await page.goto(origin);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("article")!);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.evaluate(() => {
    if (!document.execCommand("copy")) throw Error("Browser copy declined");
  });
  const copied = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const entry = items.find((i) => i.types.includes("text/html"));
    if (!entry) return null;
    return (await entry.getType("text/html")).text();
  });
  assert(
    copied?.includes("<strong>") &&
      copied.includes('href="https://example.com/') &&
      copied.includes("<li>"),
  );
  writeFileSync(
    "/tmp/134-rich-browser-clipboard.json",
    JSON.stringify(
      { html: copied, sourceHTML: html, actualBrowserClipboard: true },
      null,
      2,
    ),
  );
  console.log("Actual browser clipboard retains bold/link/list HTML");
} finally {
  await browser.close();
  server.stop();
}
