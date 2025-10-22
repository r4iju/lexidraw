export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import type { Browser, LaunchOptions, Page } from "puppeteer-core";

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

async function ensurePageReady(page: Page, timeoutMs: number) {
  try {
    // fonts
    await page.evaluate(async () => {
      try {
        const d = document as unknown as {
          fonts?: { ready?: Promise<unknown> };
        };
        await d.fonts?.ready;
      } catch {}
    });
  } catch {}
  try {
    // decode images best-effort
    await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) => {
          const el = img as HTMLImageElement & { decode?: () => Promise<void> };
          if (typeof el.decode === "function") {
            return el.decode().catch(() => {});
          }
          if (el.complete) return Promise.resolve();
          return new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };
            const t = setTimeout(finish, 4000);
            el.addEventListener(
              "load",
              () => {
                clearTimeout(t);
                finish();
              },
              { once: true },
            );
            el.addEventListener(
              "error",
              () => {
                clearTimeout(t);
                finish();
              },
              { once: true },
            );
          });
        }),
      );
    });
  } catch {}
  try {
    await new Promise((r) => setTimeout(r, Math.min(200, timeoutMs / 50)));
  } catch {}
}

async function waitForIframeAndContent(
  page: Page,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Wait for screenshot-root and optional iframe to mount
  await page
    .waitForSelector("#screenshot-root", { timeout: timeoutMs })
    .catch(() => {});
  // Wait for iframe document to be ready, if present
  while (Date.now() < deadline) {
    const hasReady = await page.evaluate(() => {
      const iframe = document.getElementById(
        "doc-frame",
      ) as HTMLIFrameElement | null;
      if (!iframe) return false;
      try {
        const d = iframe.contentDocument as Document | null;
        return !!d && d.readyState === "complete";
      } catch {
        return false;
      }
    });
    if (hasReady) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  // If a frame is present, wait for content root in the frame
  try {
    const frame = page
      .frames()
      .find((f) => f.url().includes("/screenshot/view/"));
    if (frame) {
      await frame
        .waitForSelector("#lexical-content, [id^='lexical-content-']", {
          timeout: Math.max(500, timeoutMs / 2),
        })
        .catch(() => {});
    }
  } catch {}
}

async function waitForStableLayout(
  page: Page,
  selector: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: { w: number; h: number } | null = null;
  let stableCount = 0;
  while (Date.now() < deadline && stableCount < 3) {
    const cur = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      const r = el?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
    }, selector);
    if (!cur) {
      await new Promise((r) => setTimeout(r, 120));
      continue;
    }
    if (
      last &&
      Math.abs(last.w - cur.w) <= 1 &&
      Math.abs(last.h - cur.h) <= 1
    ) {
      stableCount += 1;
    } else {
      stableCount = 0;
      last = cur;
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      url?: string;
      cookiesHeader?: string;
      selector?: string;
      viewport?: { width: number; height: number; deviceScaleFactor?: number };
      image?: { type?: "webp" | "png"; quality?: number };
      waitUntil?: WaitUntil;
      timeoutMs?: number;
      theme?: "light" | "dark";
    };
    const url = body?.url ?? "";
    if (!url) return new NextResponse("Missing url", { status: 400 });
    if (!isHttpUrl(url))
      return new NextResponse("Only http/https URLs are supported", {
        status: 400,
      });
    const { hostname } = new URL(url);
    const allowPrivate = process.env.NODE_ENV !== "production";
    if (isPrivateHostname(hostname) && !allowPrivate) {
      return new NextResponse("Private hostnames are not allowed", {
        status: 400,
      });
    }

    const waitUntil = body?.waitUntil ?? "networkidle2";
    const timeoutMs = Math.max(1000, Math.min(60000, body?.timeoutMs ?? 15000));
    const selector =
      body?.selector ??
      "#lexical-content, [id^='lexical-content-'], #screenshot-root";
    const vp = body?.viewport ?? {
      width: 1200,
      height: 900,
      deviceScaleFactor: 1,
    };
    const image = body?.image ?? { type: "webp", quality: 92 };

    // Launch Chromium
    let browser: Browser | undefined;
    try {
      const isProdVercel =
        process.env.VERCEL === "1" && process.env.NODE_ENV === "production";
      if (isProdVercel) {
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
        browser = await puppeteer.launch({
          headless: chromium.headless ?? true,
          args: chromium.args,
          executablePath: await chromium.executablePath(),
          defaultViewport: vp,
        } satisfies LaunchOptions);
      } else {
        const puppeteer = (await import("puppeteer")) as unknown as {
          launch: (opts?: LaunchOptions) => Promise<Browser>;
        };
        browser = await puppeteer.launch({
          headless: true,
          defaultViewport: vp,
        });
      }
    } catch (e) {
      console.error("screenshot:launch_error", e);
      return new NextResponse("Launch failed", { status: 500 });
    }

    try {
      const page = await (browser as Browser).newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      );
      const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
      await page.setExtraHTTPHeaders({
        "accept-language": "en-US,en;q=0.9",
        ...(body?.cookiesHeader ? { cookie: body.cookiesHeader } : {}),
        ...(vercelBypass ? { "x-vercel-protection-bypass": vercelBypass } : {}),
      });
      page.on("dialog", async (d) => {
        try {
          await d.dismiss();
        } catch {}
      });

      // Always pass Vercel protection bypass (header already set globally). As a fallback, add query param.
      const gotoUrl = (() => {
        try {
          if (!vercelBypass) return url;
          const u = new URL(url);
          u.searchParams.set("x-vercel-protection-bypass", vercelBypass);
          return u.toString();
        } catch {
          return url;
        }
      })();
      await page.goto(gotoUrl, { waitUntil, timeout: timeoutMs });
      // Enforce theme if provided
      if (body?.theme === "dark" || body?.theme === "light") {
        await page.evaluate((t) => {
          const html = document.documentElement as HTMLElement & {
            style: { colorScheme?: string };
          };
          const isDark = t === "dark";
          html.classList.toggle("dark", isDark);
          try {
            html.style.colorScheme = isDark ? "dark" : "light";
          } catch {}
          try {
            localStorage.setItem("theme", t);
          } catch {}
        }, body.theme);
        // Also set theme inside iframe if present
        try {
          const frame = page
            .frames()
            .find((f) => f.url().includes("/screenshot/view/"));
          if (frame) {
            await frame.evaluate((t) => {
              const html = document.documentElement as HTMLElement & {
                style: { colorScheme?: string };
              };
              const isDark = t === "dark";
              html.classList.toggle("dark", isDark);
              try {
                html.style.colorScheme = isDark ? "dark" : "light";
              } catch {}
              try {
                localStorage.setItem("theme", t);
              } catch {}
            }, body.theme);
          }
        } catch {}
      }
      await ensurePageReady(page, timeoutMs);
      await waitForIframeAndContent(page, timeoutMs);
      await waitForStableLayout(
        page,
        "#screenshot-root",
        Math.max(600, timeoutMs / 3),
      );

      // Locate element and compute clip (wait for client-rendered content)
      const started = Date.now();
      const maxWait = Math.min(12000, Math.max(1000, timeoutMs - 2000));
      let info = null as {
        x: number;
        y: number;
        width: number;
        height: number;
        dpr: number;
        topTrimPx?: number;
      } | null;
      while (Date.now() - started < maxWait && !info) {
        info = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width < 10 || r.height < 10) return null;

          // Heuristic: measure spacing to first visible child (e.g., heading with mt-8)
          const getFirstVisibleTop = (root: Element): number | null => {
            const walker = document.createTreeWalker(
              root,
              NodeFilter.SHOW_ELEMENT,
            );
            while (walker.nextNode()) {
              const n = walker.currentNode as HTMLElement;
              const cs = getComputedStyle(n);
              if (cs.display === "none" || cs.visibility === "hidden") continue;
              const rr = n.getBoundingClientRect();
              if (rr.height > 2 && rr.width > 2) return rr.top;
            }
            return null;
          };
          const firstTop = getFirstVisibleTop(el);
          const topTrimPx =
            firstTop != null ? Math.max(0, firstTop - r.top) : 0;

          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            dpr: window.devicePixelRatio || 1,
            topTrimPx,
          } as {
            x: number;
            y: number;
            width: number;
            height: number;
            dpr: number;
            topTrimPx: number;
          };
        }, selector);
        if (info) break;
        await new Promise((r) => setTimeout(r, 120));
      }

      // If not found in top document, try inside iframe #doc-frame
      if (!info) {
        try {
          const iframeRect = await page.evaluate(() => {
            const iframe = document.getElementById(
              "doc-frame",
            ) as HTMLIFrameElement | null;
            if (!iframe) return null;
            const r = iframe.getBoundingClientRect();
            return { x: r.x, y: r.y };
          });
          const frame = page
            .frames()
            .find((f) => f.url().includes("/screenshot/view/"));
          if (iframeRect && frame) {
            const t0 = Date.now();
            let inner: {
              x: number;
              y: number;
              width: number;
              height: number;
              topTrimPx?: number;
            } | null = null;
            while (Date.now() - t0 < maxWait && !inner) {
              inner = await frame.evaluate((sel: string) => {
                const el = document.querySelector(sel) as HTMLElement | null;
                if (!el) return null;
                const r = el.getBoundingClientRect();
                if (r.width < 10 || r.height < 10) return null;
                const getFirstVisibleTop = (root: Element): number | null => {
                  const walker = document.createTreeWalker(
                    root,
                    NodeFilter.SHOW_ELEMENT,
                  );
                  while (walker.nextNode()) {
                    const n = walker.currentNode as HTMLElement;
                    const cs = getComputedStyle(n);
                    if (cs.display === "none" || cs.visibility === "hidden")
                      continue;
                    const rr = n.getBoundingClientRect();
                    if (rr.height > 2 && rr.width > 2) return rr.top;
                  }
                  return null;
                };
                const firstTop = getFirstVisibleTop(el);
                const topTrimPx =
                  firstTop != null ? Math.max(0, firstTop - r.top) : 0;
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  topTrimPx,
                };
              }, selector);
              if (inner) break;
              await new Promise((r) => setTimeout(r, 120));
            }
            if (inner) {
              const merged = {
                x: iframeRect.x + inner.x,
                y: iframeRect.y + inner.y,
                width: inner.width,
                height: inner.height,
                dpr: 1,
                topTrimPx: inner.topTrimPx ?? 0,
              };
              info = merged as unknown as typeof info;
            }
          }
        } catch {}
      }

      // Constrain clip to the visible root area to avoid extra whitespace
      const root = await page.evaluate(() => {
        const el = document.getElementById(
          "screenshot-root",
        ) as HTMLElement | null;
        if (el) {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
        return {
          x: 0,
          y: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        };
      });

      let buffer: Buffer;
      if (info && info.width > 0 && info.height > 0) {
        const clipX = Math.max(info.x, root.x);
        let clipY = Math.max(info.y, root.y);
        const clipW =
          Math.min(info.x + info.width, root.x + root.width) - clipX;
        let clipH =
          Math.min(info.y + info.height, root.y + root.height) - clipY;
        // Adaptive trim: measure spacing from content root to first visible child
        const TRIM_CAP = 64; // safety
        const measured = info.topTrimPx ?? 0;
        const trim = Math.min(
          TRIM_CAP,
          Math.max(0, Math.min(measured, clipH - 1)),
        );
        clipY += trim;
        // Add the trimmed amount back at the bottom, clamped to root bounds
        const rootBottom = root.y + root.height;
        const desired = clipH + trim;
        const maxPossible = rootBottom - clipY;
        clipH = Math.max(1, Math.min(desired, maxPossible));
        buffer = (await page.screenshot({
          type: (image.type as "png" | "webp") ?? "webp",
          quality: image.quality,
          clip: {
            x: Math.max(0, clipX),
            y: Math.max(0, clipY),
            width: Math.max(1, clipW),
            height: Math.max(1, clipH),
          },
          omitBackground: true,
        })) as Buffer;
      } else {
        // fallback full viewport
        buffer = (await page.screenshot({
          type: (image.type as "png" | "webp") ?? "webp",
          quality: image.quality,
        })) as Buffer;
      }

      const u8 = new Uint8Array(buffer);
      const blob = new Blob([u8.buffer], {
        type: image.type === "png" ? "image/png" : "image/webp",
      });
      return new NextResponse(blob, {
        status: 200,
        headers: { "cache-control": "no-store" },
      });
    } catch (e) {
      console.error("screenshot:page_error", e);
      return new NextResponse("Screenshot failed", { status: 500 });
    } finally {
      try {
        await browser?.close();
      } catch {}
    }
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
}
