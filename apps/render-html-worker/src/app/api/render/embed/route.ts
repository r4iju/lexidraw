import { NextResponse } from "next/server";
import { refusedUnlessFromTheApp } from "~/lib/worker-access";
import { launchGuardedBrowser } from "~/lib/guarded-browser";
import { guardRequests, renderCheck } from "~/lib/public-requests";

export const maxDuration = 60;

export async function POST(request: Request) {
  const refusal = refusedUnlessFromTheApp(request);
  if (refusal) return refusal;
  if (Number(request.headers.get("content-length")) > 300000)
    return new NextResponse("Payload too large", { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new NextResponse("Missing payload", { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 300000) {
      await reader.cancel();
      return new NextResponse("Payload too large", { status: 413 });
    }
    chunks.push(chunk.value);
  }
  const payload = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(payload);
  let input: { url: string; request: unknown };
  try {
    const value: unknown = JSON.parse(text);
    if (
      !value ||
      typeof value !== "object" ||
      !("url" in value) ||
      typeof value.url !== "string" ||
      !("request" in value)
    )
      throw new Error("Invalid input");
    const url = new URL(value.url);
    if (!/^https?:$/.test(url.protocol) || url.pathname !== "/native-render")
      throw new Error("Invalid renderer URL");
    input = { url: url.toString(), request: value.request };
  } catch {
    return new NextResponse("Invalid render request", { status: 400 });
  }
  const check = renderCheck();
  const browser = await launchGuardedBrowser({
    viewport: { width: 2048, height: 900, deviceScaleFactor: 2 },
    check,
  });
  try {
    const page = await browser.newPage();
    await guardRequests(page, check);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(input.url, { waitUntil: "networkidle0", timeout: 45000 });
    await page.waitForFunction(
      () => typeof window.renderNativeEmbed === "function",
      { timeout: 15000 },
    );
    await page.evaluate(
      (payload) => window.renderNativeEmbed?.(payload),
      input.request,
    );
    await page.waitForFunction(() => window.nativeEmbedReady?.() === true, {
      timeout: 30000,
    });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.querySelectorAll("#native-embed img")).map(
          (image) =>
            image instanceof HTMLImageElement
              ? image.decode()
              : Promise.resolve(),
        ),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    if (errors.length) throw new Error(errors.join("\n"));
    const element = await page.$("#native-embed");
    if (!element) throw new Error("No rendered embed");
    const bounds = await element.boundingBox();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0)
      throw new Error("Empty render");
    if (bounds.width * bounds.height * 4 > 16000000)
      return new NextResponse("Render exceeds 16 megapixels", { status: 413 });
    const svg = await page.evaluate(async () => {
      const original = document.getElementById("native-embed");
      if (!original) throw new Error("No rendered embed");
      const clone = original.cloneNode(true);
      if (!(clone instanceof HTMLElement))
        throw new Error("Invalid render root");
      const originals = [original, ...original.querySelectorAll("*")];
      const copies = [clone, ...clone.querySelectorAll("*")];
      for (let i = 0; i < originals.length; i++) {
        const source = originals[i];
        const target = copies[i];
        if (
          !source ||
          !(target instanceof HTMLElement || target instanceof SVGElement)
        )
          continue;
        const style = getComputedStyle(source);
        for (const property of style)
          target.style.setProperty(property, style.getPropertyValue(property));
        if (
          source instanceof HTMLImageElement &&
          target instanceof HTMLImageElement &&
          source.src
        ) {
          const blob = await (await fetch(source.src)).blob();
          target.src = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              typeof reader.result === "string"
                ? resolve(reader.result)
                : reject(new Error("Invalid image"));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
      }
      const box = original.getBoundingClientRect();
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      clone.style.margin = "0";
      const markup = new XMLSerializer().serializeToString(clone);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
    });
    const png = Buffer.from(
      await element.screenshot({ type: "png", omitBackground: true }),
    ).toString("base64");
    return NextResponse.json({
      svg,
      png,
      width: bounds.width,
      height: bounds.height,
    });
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : "Render failed",
      { status: 422 },
    );
  } finally {
    await browser.close();
  }
}

declare global {
  interface Window {
    renderNativeEmbed?: (input: unknown) => void;
    nativeEmbedReady?: () => boolean;
  }
}
