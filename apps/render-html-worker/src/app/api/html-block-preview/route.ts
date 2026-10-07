import { NextResponse } from "next/server";
import { parseHTML } from "linkedom";
import {
  HTML_BLOCK_THEMES,
  type HTMLBlockTheme,
  parseHTMLBlockSource,
  snapshotDocument,
} from "@packages/lexical-nodes/html-block";
import {
  prepareHTML,
  startHTMLBlock,
} from "@packages/lexical-nodes/html-block/runtime";
import { refusedUnlessFromTheApp } from "../../../lib/worker-access";
import { launchBrowser } from "../../../lib/launch-browser";
export const runtime = "nodejs";
export const maxDuration = 30;
/** Captures running at once; each launches its own Chromium. */
const CONCURRENT = 2;
/** Captures waiting for a turn; past this the caller retries later. */
const QUEUED = 12;
const WAIT_MS = 12000;
let active = 0;
const waiting: (() => void)[] = [];
/** Resolves with a release function once a capture may start, or undefined when the queue is full or the wait ran out. */
async function turn(): Promise<(() => void) | undefined> {
  if (active >= CONCURRENT) {
    if (waiting.length >= QUEUED) return undefined;
    const admitted = await new Promise<boolean>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const index = waiting.indexOf(wake);
        if (index >= 0) waiting.splice(index, 1);
        resolve(false);
      }, WAIT_MS);
      waiting.push(wake);
    });
    if (!admitted) return undefined;
  } else active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    // The slot passes straight to the next waiter, so `active` stays put.
    if (next) next();
    else active--;
  };
}
const busy = () =>
  new NextResponse("Preview renderer is busy", {
    status: 503,
    headers: { "retry-after": "2" },
  });
export async function POST(request: Request) {
  const refusal = refusedUnlessFromTheApp(request);
  if (refusal) return refusal;
  const text = await request.text();
  if (text.length > 200000)
    return new NextResponse("Preview request too large", { status: 413 });
  let input: {
    source: ReturnType<typeof parseHTMLBlockSource>;
    width: number;
    theme: HTMLBlockTheme;
  };
  try {
    const raw = JSON.parse(text);
    input = {
      source: parseHTMLBlockSource(raw.source),
      width: raw.width,
      theme: raw.theme ?? "light",
    };
    if (
      !HTML_BLOCK_THEMES.includes(input.theme) ||
      !Number.isInteger(input.width) ||
      input.width < 320 ||
      input.width > 1280
    )
      throw new Error("Invalid width");
  } catch {
    return new NextResponse("Invalid HTML block preview request", {
      status: 400,
    });
  }
  const release = await turn();
  if (!release) return busy();
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  let interpreter: { dispose(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { document } = parseHTML("<html><body></body></html>");
    prepareHTML(document.body, input.source.html);
    interpreter = await startHTMLBlock(document.body, input.source);
    const html = snapshotDocument(
      document.body.innerHTML,
      input.source.css,
      input.theme,
    );
    browser = await launchBrowser({
      viewport: {
        width: input.width,
        height: input.source.height,
        deviceScaleFactor: 1,
      },
    });
    const launched = browser;
    timer = setTimeout(() => {
      void launched.close();
    }, 15000);
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: input.theme },
    ]);
    await page.setRequestInterception(true);
    // This page has no navigated origin, cookies, extra headers or render tokens.
    page.on("request", (request) => {
      void request.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout: 10000 });
    const png = await page.screenshot({ type: "png", omitBackground: true });
    if (png.byteLength > 4 * 1024 * 1024)
      throw new Error("Preview image exceeds limit");
    return new NextResponse(Buffer.from(png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Preview capture failed",
      },
      { status: 422 },
    );
  } finally {
    if (timer) clearTimeout(timer);
    try {
      interpreter?.dispose();
      await browser?.close();
    } finally {
      release();
    }
  }
}
