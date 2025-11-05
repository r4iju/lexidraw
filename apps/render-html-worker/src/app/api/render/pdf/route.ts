import { type NextRequest, NextResponse } from "next/server";
import type { Browser, LaunchOptions, Page } from "puppeteer-core";

export const maxDuration = 60;

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

function isIpAddress(hostname: string): boolean {
  // IPv4 pattern: 192.168.0.25, 10.0.0.1, etc.
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(hostname)) {
    return hostname.split(".").every((octet) => {
      const num = Number.parseInt(octet, 10);
      return num >= 0 && num <= 255;
    });
  }
  // IPv6 pattern (simplified check)
  return hostname.includes(":") && !hostname.includes(".");
}

function normalizeUrl(url: string): string {
  // Extract hostname from URL (may include port)
  let hostname: string;
  let urlWithoutProtocol: string;

  // Check if URL already has a protocol
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      hostname = parsed.hostname;
      urlWithoutProtocol = url.replace(/^https?:\/\//i, "");
    } catch {
      // Fallback: extract hostname manually
      const match = url.match(/^https?:\/\/([^/:]+)/i);
      hostname = match ? match[1] : "";
      urlWithoutProtocol = url.replace(/^https?:\/\//i, "");
    }
  } else {
    // Extract hostname from URL without protocol
    const match = url.match(/^([^/:]+)/);
    hostname = match ? match[1].split(":")[0] : url.split("/")[0].split(":")[0];
    urlWithoutProtocol = url;
  }

  // Always use http:// for localhost or IP addresses, https:// otherwise
  const protocol =
    isPrivateHostname(hostname) || isIpAddress(hostname)
      ? "http://"
      : "https://";
  return protocol + urlWithoutProtocol;
}

async function ensurePageReady(page: Page, timeoutMs: number) {
  try {
    // Wait for fonts
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
    // Decode images best-effort
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
    // Wait for custom ready signal if present
    await page.evaluate(() => {
      const w = window as unknown as {
        __readyForPdf__?: boolean;
      };
      if (w.__readyForPdf__) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const check = () => {
          if (w.__readyForPdf__) {
            resolve();
            return;
          }
          setTimeout(check, 100);
        };
        check();
        setTimeout(() => resolve(), 2000); // timeout after 2s
      });
    });
  } catch {}
  try {
    await new Promise((r) => setTimeout(r, Math.min(300, timeoutMs / 50)));
  } catch {}
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      url?: string;
      cookiesHeader?: string;
      format?: "A4" | "Letter";
      orientation?: "portrait" | "landscape";
      margin?: {
        top?: string;
        right?: string;
        bottom?: string;
        left?: string;
      };
      headerTemplate?: string;
      footerTemplate?: string;
      waitUntil?: WaitUntil;
      timeoutMs?: number;
    };
    let url = body?.url ?? "";
    if (!url) return new NextResponse("Missing url", { status: 400 });
    url = normalizeUrl(url);
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

    const waitUntil = body?.waitUntil ?? "networkidle0";
    const timeoutMs = Math.max(5000, Math.min(60000, body?.timeoutMs ?? 30000));
    const format = body?.format ?? "A4";
    const orientation = body?.orientation ?? "portrait";
    const margin = body?.margin ?? {
      top: "14mm",
      right: "14mm",
      bottom: "16mm",
      left: "14mm",
    };

    // Default header/footer templates
    const headerTemplate =
      body?.headerTemplate ??
      '<div style="font-size: 8px; width: 100%; text-align: center;"></div>';
    const footerTemplate =
      body?.footerTemplate ??
      '<div style="font-size: 8px; width: 100%; text-align: center;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>';

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
          defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
        } satisfies LaunchOptions);
      } else {
        const puppeteer = (await import("puppeteer")) as unknown as {
          launch: (opts?: LaunchOptions) => Promise<Browser>;
        };
        browser = await puppeteer.launch({
          headless: true,
          defaultViewport: { width: 1200, height: 900, deviceScaleFactor: 1 },
        });
      }
    } catch (e) {
      console.error("render-pdf:launch_error", e);
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

      // Add bypass to URL if needed
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

      // Hide UI elements that shouldn't be in PDF
      try {
        const hideCss = `*{cursor:none !important}
          [data-cursor], [data-presence], [data-presence-root], .presence, .cursor,
          [data-component-name='Toolbar'],
          [data-component-name='TtsToolbar'],
          [data-component-name='Sidebar'],
          [data-component-name='CommentPlugin'],
          [data-component-name='OptionsDropdown'],
          [data-component-name='ModeToggle'],
          [data-component-name='FloatingLinkEditor'],
          [data-component-name='FloatingTextFormatToolbar'],
          [data-component-name='ContextMenu'],
          [data-component-name='LLMWidget'],
          [data-component-name='AutocompletePlugin'],
          #nextjs-portal-root, [data-nextjs-overlay], [data-nextjs-error-overlay],
          [data-nextjs-toast], [data-nextjs-dialog] { display:none !important; }`;
        await page.addStyleTag({ content: hideCss });
      } catch {}

      await ensurePageReady(page, timeoutMs);

      // Wait for content to be ready
      try {
        await page.waitForSelector(
          "[id^='lexical-content-'], .print-container",
          {
            timeout: Math.max(5000, timeoutMs / 2),
          },
        );
      } catch {}

      // Generate PDF
      const pdfBuffer = (await page.pdf({
        format,
        landscape: orientation === "landscape",
        printBackground: true,
        preferCSSPageSize: true,
        margin,
        headerTemplate,
        footerTemplate,
        displayHeaderFooter: true,
      })) as Buffer;

      return new NextResponse(Buffer.from(pdfBuffer), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "cache-control": "no-store",
        },
      });
    } catch (e) {
      console.error("render-pdf:page_error", e);
      return new NextResponse("PDF generation failed", { status: 500 });
    } finally {
      try {
        await browser?.close();
      } catch {}
    }
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
}
