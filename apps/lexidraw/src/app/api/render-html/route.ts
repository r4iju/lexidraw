export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import type { Browser, LaunchOptions } from "puppeteer-core";
// Avoid importing external types that may not resolve at type time in serverless envs
// Define minimal interfaces used below

type WaitUntil = "load" | "domcontentloaded" | "networkidle0" | "networkidle2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    const isVercel = Boolean(process.env.VERCEL);

    let chromium: {
      args: string[];
      executablePath: () => Promise<string>;
    } | null = null;
    if (isVercel) {
      const mod = (await import("@sparticuz/chromium")) as unknown as {
        default: { args: string[]; executablePath: () => Promise<string> };
      };
      chromium = mod.default;
    }

    const puppeteer = (await import("puppeteer-core")) as unknown as {
      launch: (opts?: LaunchOptions) => Promise<Browser>;
    };

    const launchOptions: LaunchOptions = isVercel
      ? {
          headless: true,
          args: chromium?.args ?? [],
          executablePath: chromium
            ? await chromium.executablePath()
            : undefined,
          defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
        }
      : {
          headless: true,
          defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
        };

    let browser: Browser;
    try {
      browser = await puppeteer.launch(launchOptions);
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
      // Fail fast on dialogs
      page.on("dialog", async (d: { dismiss: () => Promise<void> }) => {
        try {
          await d.dismiss();
        } catch {}
      });

      await page.goto(url, { waitUntil, timeout: timeoutMs });

      // Cap size
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
