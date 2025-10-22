export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import type { Browser, LaunchOptions } from "puppeteer-core";
import { getNordHttpsProxyUrls } from "@packages/lib";

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

async function performPageWorkflow(
  page: any,
  url: string,
  cookiesHeader: string | undefined,
  waitUntil: WaitUntil,
  timeoutMs: number,
): Promise<string> {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  );
  await page.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9",
    ...(cookiesHeader ? { cookie: cookiesHeader } : {}),
  });
  page.on("dialog", async (d: any) => {
    try {
      await d.dismiss();
    } catch {}
  });

  await page.goto(url, { waitUntil, timeout: timeoutMs });

  const autoConsent =
    String(
      process.env.HEADLESS_AUTO_CONSENT_ENABLED ?? "true",
    ).toLowerCase() === "true";
  if (autoConsent) {
    try {
      const clickedMain = await page.evaluate(async () => {
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
      if (!clickedMain) {
        for (const frame of page.frames()) {
          try {
            const res = await frame.evaluate(() => {
              const attemptClick = (sel: string): boolean => {
                const el = document.querySelector(sel) as HTMLElement | null;
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                const visible = rect.width > 0 && rect.height > 0;
                if (!visible) return false;
                try {
                  (el as HTMLElement).click();
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
            if (res) break;
          } catch {}
        }
      }
      await page?.waitForTimeout(300);
    } catch {}
  }

  try {
    await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, Math.floor(window.innerHeight * 0.5));
        await sleep(75);
      }
    });
  } catch {}

  try {
    const start = Date.now();
    const timeout = Math.min(12000, timeoutMs);
    while (Date.now() - start < timeout) {
      const ready = await page.evaluate(() => {
        const q = (sel: string) => document.querySelector(sel);
        if (q("main article") || q("[role='main'] article") || q("article"))
          return true;
        const pCount = document.querySelectorAll("main p, body p").length;
        return pCount >= 10;
      });
      if (ready) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  } catch {}

  const html = await page.content();
  const bytes = Buffer.byteLength(html, "utf8");
  const MAX_BYTES = 10 * 1024 * 1024; // 10MB
  if (bytes > MAX_BYTES) throw new Error("Rendered HTML too large");
  return html;
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

    // 1) Direct attempt
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
      browser = undefined as unknown as Browser; // fallthrough to proxy pool
    }

    try {
      const page = await browser.newPage();
      const html = await performPageWorkflow(
        page,
        url,
        body?.cookiesHeader,
        waitUntil,
        timeoutMs,
      );
      return NextResponse.json({ html });
    } catch (e) {
      // 2) Proxy pool fallback with concurrency
      console.error("render-html:direct_error", e);
      try {
        await browser?.close();
      } catch {}

      const user = process.env.NORDVPN_SERVICE_USER;
      const pass = process.env.NORDVPN_SERVICE_PASS;
      if (!user || !pass)
        return new NextResponse("Proxy creds missing", { status: 500 });

      const urls = (
        await getNordHttpsProxyUrls({ user, pass, limit: 100 })
      ).slice(0, 50);
      const isProdVercel =
        process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
      const CONCURRENCY = isProdVercel ? 3 : 10;
      let idx = 0;
      let inFlight = 0;
      let resolvedHtml: string | null = null;

      const runOne = async (): Promise<void> => {
        if (resolvedHtml) return;
        const myIdx = idx++;
        if (myIdx >= urls.length) return;
        const proxyUrl = urls[myIdx];
        inFlight += 1;
        try {
          const u = new URL(proxyUrl);
          const proxyServer = `${u.protocol}//${u.hostname}:${u.port || 89}`;
          const username = decodeURIComponent(u.username || user);
          const password = decodeURIComponent(u.password || pass);

          const isProd = isProdVercel;
          let browserLocal: Browser;
          if (isProd) {
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
              args: [...chromium.args, `--proxy-server=${proxyServer}`],
              executablePath: await chromium.executablePath(),
              defaultViewport: {
                width: 1200,
                height: 900,
                deviceScaleFactor: 1,
              },
            };
            browserLocal = await puppeteer.launch(launchOptions);
          } else {
            const puppeteer = (await import("puppeteer")) as unknown as {
              launch: (opts?: LaunchOptions) => Promise<Browser>;
            };
            browserLocal = await puppeteer.launch({
              headless: true,
              args: [`--proxy-server=${proxyServer}`],
              defaultViewport: {
                width: 1200,
                height: 900,
                deviceScaleFactor: 1,
              },
            });
          }

          try {
            const page = await browserLocal.newPage();
            if (username && password)
              await page.authenticate({ username, password });
            const html = await performPageWorkflow(
              page,
              url,
              body?.cookiesHeader,
              waitUntil,
              timeoutMs,
            );
            if (!resolvedHtml) resolvedHtml = html;
          } finally {
            try {
              await browserLocal.close();
            } catch {}
          }
        } catch (_e) {
          // ignore and let others continue
        } finally {
          inFlight -= 1;
          if (!resolvedHtml && idx < urls.length) void runOne();
        }
      };

      const starters = Math.min(CONCURRENCY, urls.length);
      for (let i = 0; i < starters; i++) void runOne();
      while (!resolvedHtml && (inFlight > 0 || idx < urls.length)) {
        await new Promise((r) => setTimeout(r, 20));
      }
      if (resolvedHtml) return NextResponse.json({ html: resolvedHtml });
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
