import { NextResponse } from "next/server";
import { refusedUnlessFromTheApp } from "~/lib/worker-access";
import { launchGuardedBrowser } from "~/lib/guarded-browser";
import { guardRequests } from "~/lib/public-requests";

export const maxDuration = 60;

export async function POST(request: Request) {
  const refusal = refusedUnlessFromTheApp(request);
  if (refusal) return refusal;
  if (Number(request.headers.get("content-length")) > 10_667_000)
    return new NextResponse("Payload too large", { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new NextResponse("Missing SVG", { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 10_667_000) {
      await reader.cancel();
      return new NextResponse("Payload too large", { status: 413 });
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let source: string;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (
      !value ||
      typeof value !== "object" ||
      !("source" in value) ||
      typeof value.source !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value.source)
    )
      throw new Error("Invalid SVG");
    if (Buffer.from(value.source, "base64").byteLength > 8_000_000)
      return new NextResponse("SVG too large", { status: 413 });
    source = value.source;
  } catch {
    return new NextResponse("Invalid SVG", { status: 400 });
  }
  // SVG is loaded as an inert image; this preview has no permitted remote resources.
  const check = async () => undefined;
  const browser = await launchGuardedBrowser({
    viewport: { width: 2048, height: 2048, deviceScaleFactor: 1 },
    check,
  });
  const timeout = setTimeout(() => {
    void browser.close().catch(() => {});
  }, 45000);
  try {
    const page = await browser.newPage();
    await guardRequests(page, check);
    const output = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${source}`;
      await image.decode();
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (width < 1 || height < 1 || width > 16384 || height > 16384)
        throw new Error("SVG dimensions exceed the image limit");
      const scale = Math.min(2, 2048 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return {
        png: canvas.toDataURL("image/png").split(",")[1],
        width,
        height,
        rasterWidth: canvas.width,
        rasterHeight: canvas.height,
      };
    }, source);
    if (!output.png || output.png.length > 12_000_000)
      return new NextResponse("SVG preview exceeds the image limit", {
        status: 413,
      });
    return NextResponse.json(output);
  } catch {
    return new NextResponse("SVG could not be rendered", { status: 400 });
  } finally {
    clearTimeout(timeout);
    await browser.close();
  }
}
