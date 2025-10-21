export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import type { Browser, LaunchOptions } from "puppeteer-core";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type WaitUntil = "load" | "domcontentloaded" | "networkidle0" | "networkidle2";

function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function isPrivateHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      url?: string;
      cookiesHeader?: string;
      waitUntil?: WaitUntil;
      timeoutMs?: number;
    };
    const url = body?.url ?? "";
    if (!url) return new NextResponse("Missing url", { status: 400 });
    if (!isHttpUrl(url))
      return new NextResponse("Only http/https URLs are supported", {
        status: 400,
      });
    const { hostname } = new URL(url);
    if (isPrivateHostname(hostname))
      return new NextResponse("Private hostnames are not allowed", {
        status: 400,
      });

    const waitUntil = body?.waitUntil ?? "domcontentloaded";
    const timeoutMs = Math.max(1000, Math.min(60000, body?.timeoutMs ?? 15000));

    let browser: Browser;
    try {
      const isProdVercel =
        process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
      if (isProdVercel) {
        // Ensure @sparticuz/chromium inflates libs for AL2023
        process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs20.x";
        process.env.AWS_LAMBDA_JS_RUNTIME ??= "nodejs20.x";
        process.env.FONTCONFIG_PATH ??= "/tmp/fonts";
        const prevLd = process.env.LD_LIBRARY_PATH || "";
        process.env.LD_LIBRARY_PATH = [
          "/tmp/al2023/lib",
          "/tmp/al2/lib",
          prevLd,
        ]
          .filter(Boolean)
          .join(":");

        const chromium = (await import("@sparticuz/chromium"))
          .default as unknown as {
          args: string[];
          headless?: boolean;
          executablePath: () => Promise<string>;
        };
        const puppeteer = await import("puppeteer-core");
        const launchOptions: LaunchOptions = {
          headless: chromium.headless ?? true,
          args: chromium.args,
          executablePath: await chromium.executablePath(),
          defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
        };
        browser = await puppeteer.launch(launchOptions);
      } else {
        // Local dev / non-Vercel: use full Puppeteer (bundled Chromium) for host OS
        const puppeteer = (await import("puppeteer")) as unknown as {
          launch: (opts?: LaunchOptions) => Promise<Browser>;
        };
        browser = await puppeteer.launch({
          headless: true,
          defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
        });
      }
    } catch (e) {
      console.error("render-html:launch_error", e);
      return new NextResponse("Failed to launch browser", { status: 500 });
    }

    try {
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      );
      await page.setExtraHTTPHeaders({
        "accept-language": "en-US,en;q=0.9",
        ...(body?.cookiesHeader ? { cookie: body.cookiesHeader } : {}),
      });
      page.on("dialog", async (d: any) => {
        try {
          await d.dismiss();
        } catch {}
      });

      await page.goto(url, { waitUntil, timeout: timeoutMs });

      const html = await page.content();
      const bytes = Buffer.byteLength(html, "utf8");
      const MAX_BYTES = 10 * 1024 * 1024; // 10MB
      if (bytes > MAX_BYTES) {
        return new NextResponse("Rendered HTML too large", { status: 413 });
      }

      return NextResponse.json({ html });
    } catch (e) {
      console.error("render-html:error", e);
      return new NextResponse("Render failed", { status: 500 });
    } finally {
      try {
        await browser?.close();
      } catch {}
    }
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
}
