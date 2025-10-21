export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Browser, LaunchOptions } from "puppeteer-core";
// Avoid importing external types that may not resolve at type time in serverless envs
// Define minimal interfaces used below

type WaitUntil = "load" | "domcontentloaded" | "networkidle0" | "networkidle2";

export const dynamic = "force-dynamic";

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

    let browser: Browser;
    try {
      if (isVercel) {
        const chromium = (await import("@sparticuz/chromium"))
          .default as unknown as {
          args: string[];
          executablePath: () => Promise<string>;
          headless?: boolean;
        };
        const puppeteer = await import("puppeteer-core");
        // Ensure the dynamic linker can find Chromium's bundled NSS libraries on Vercel (Fluid Compute)
        try {
          const execPath = await chromium.executablePath();
          const baseDir = path.dirname(execPath);
          const libDirCandidates = [
            path.join(baseDir, "lib"),
            "/var/task/node_modules/@sparticuz/chromium/lib",
            path.join(
              process.cwd(),
              "node_modules",
              "@sparticuz",
              "chromium",
              "lib",
            ),
          ];
          const tmpLibDir = "/tmp/chromium-libs";
          try {
            await fs.mkdir(tmpLibDir, { recursive: true });
          } catch {}
          for (const dir of libDirCandidates) {
            try {
              const entries = await fs.readdir(dir);
              for (const name of entries) {
                if (!name.startsWith("lib")) continue;
                if (!(name.endsWith(".so") || name.includes(".so."))) continue;
                const src = path.join(dir, name);
                const dst = path.join(tmpLibDir, name);
                try {
                  await fs.copyFile(src, dst);
                } catch {}
              }
            } catch {}
          }
          const existingLd = process.env.LD_LIBRARY_PATH || "";
          const mergedLd = [tmpLibDir, ...libDirCandidates].join(":");
          process.env.LD_LIBRARY_PATH = existingLd
            ? `${mergedLd}:${existingLd}`
            : mergedLd;
        } catch {}
        const launchOptions: LaunchOptions = {
          headless: chromium.headless ?? true,
          args: chromium.args,
          executablePath: await chromium.executablePath(),
          defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
        };
        browser = await puppeteer.launch(launchOptions);
      } else {
        // Local dev: use full puppeteer which bundles a browser
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
      // Fail fast on dialogs
      page.on("dialog", async (d: any) => {
        try {
          await d.dismiss();
        } catch {}
      });

      await page.goto(url, { waitUntil, timeout: timeoutMs });

      // Generic consent approver (toggleable via env, default true)
      const autoConsent =
        String(
          process.env.HEADLESS_AUTO_CONSENT_ENABLED ?? "true",
        ).toLowerCase() === "true";
      if (autoConsent) {
        try {
          const clicked = await page.evaluate(async () => {
            const attemptClick = (sel: string): boolean => {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              if (!visible) return false;
              try {
                el.click();
                return true;
              } catch {
                return false;
              }
            };
            const selectors = [
              "#onetrust-accept-btn-handler",
              ".fc-cta-consent",
              ".sp_choice_type_11",
              "[data-testid*='consent'] button",
              "button[aria-label*='consent']",
            ];
            for (const sel of selectors) {
              if (attemptClick(sel)) return true;
            }
            // Fallback by button text
            const btns = Array.from(
              document.querySelectorAll("button"),
            ) as HTMLButtonElement[];
            const re = /\b(accept|agree|consent|godkänn|acceptera)\b/i;
            for (const b of btns) {
              const txt = (b.innerText || b.textContent || "").trim();
              if (!txt) continue;
              const rect = b.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              if (!visible) continue;
              if (re.test(txt)) {
                try {
                  b.click();
                  return true;
                } catch {}
              }
            }
            return false;
          });
          if (process.env.NODE_ENV !== "production") {
            console.log("consent:clicked", { clicked });
          }
        } catch {
          // ignore failures
        }
      }

      // Nudge lazy content and wait for article-like selectors
      try {
        await page.evaluate(async () => {
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < 3; i++) {
            window.scrollBy(0, Math.floor(window.innerHeight * 0.5));
            // @ts-ignore
            await sleep(75);
          }
        });
      } catch {}
      try {
        const start = Date.now();
        const timeout = Math.min(8000, timeoutMs);
        // Poll for content readiness
        // eslint-disable-next-line no-constant-condition
        while (Date.now() - start < timeout) {
          const ready = await page.evaluate(() => {
            const q = (sel: string) => document.querySelector(sel);
            if (q("main article") || q("[role='main'] article") || q("article"))
              return true;
            const pCount = document.querySelectorAll("main p, body p").length;
            return pCount >= 10;
          });
          if (ready) {
            if (process.env.NODE_ENV !== "production") {
              console.log("content:ready");
            }
            break;
          }
          await new Promise((r) => setTimeout(r, 150));
        }
      } catch {}

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
