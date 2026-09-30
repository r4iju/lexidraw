import { NextResponse } from "next/server";
import { parseHTML } from "linkedom";
import {
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
let active = 0;
export async function POST(request: Request) {
  const refusal = refusedUnlessFromTheApp(request);
  if (refusal) return refusal;
  if (active >= 2)
    return new NextResponse("Preview renderer is busy", { status: 503 });
  const text = await request.text();
  if (text.length > 200000)
    return new NextResponse("Preview request too large", { status: 413 });
  let input: { source: ReturnType<typeof parseHTMLBlockSource>; width: number };
  try {
    const raw = JSON.parse(text);
    input = { source: parseHTMLBlockSource(raw.source), width: raw.width };
    if (
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
  if (active >= 2)
    return new NextResponse("Preview renderer is busy", { status: 503 });
  active++;
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  let interpreter: { dispose(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { document } = parseHTML("<html><body></body></html>");
    prepareHTML(document.body, input.source.html);
    interpreter = await startHTMLBlock(document.body, input.source);
    const html = snapshotDocument(document.body.innerHTML, input.source.css);
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
    await page.setRequestInterception(true);
    // This page has no navigated origin, cookies, extra headers or render tokens.
    page.on("request", (request) => {
      void request.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout: 10000 });
    const png = await page.screenshot({ type: "png" });
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
      active--;
    }
  }
}
