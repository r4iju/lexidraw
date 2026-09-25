import { copyFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, LaunchOptions, Viewport } from "puppeteer-core";
import { RENDER_FONTS } from "./render-fonts";

/** Copies the bundled faces to where the Chromium's fontconfig looks. */
async function installFonts() {
  const target = path.join(tmpdir(), "fonts", "lexidraw");
  await mkdir(target, { recursive: true });
  await Promise.all(
    RENDER_FONTS.map(async ({ file }) => {
      const source = path.join(process.cwd(), "fonts", file);
      const destination = path.join(target, file);
      const { size } = await stat(source).catch((cause) => {
        throw new Error(`The render font ${file} is not in the bundle`, {
          cause,
        });
      });
      const installed = await stat(destination).catch(() => null);
      if (installed?.size !== size) await copyFile(source, destination);
    }),
  );
}

/**
 * Starts the Chromium every route renders with: the serverless build on a
 * Vercel production deployment, the host's Puppeteer anywhere else.
 */
export async function launchBrowser({
  viewport,
  args = [],
}: {
  viewport: Viewport;
  args?: string[];
}): Promise<Browser> {
  if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production") {
    const puppeteer = (await import("puppeteer")) as unknown as {
      launch: (options?: LaunchOptions) => Promise<Browser>;
    };
    return puppeteer.launch({
      headless: true,
      args,
      defaultViewport: viewport,
    });
  }

  process.env.AWS_EXECUTION_ENV ??= "AWS_Lambda_nodejs20.x";
  process.env.AWS_LAMBDA_JS_RUNTIME ??= "nodejs20.x";
  process.env.FONTCONFIG_PATH ??= "/tmp/fonts";
  process.env.LD_LIBRARY_PATH = [
    "/tmp/al2023/lib",
    "/tmp/al2/lib",
    process.env.LD_LIBRARY_PATH,
  ]
    .filter(Boolean)
    .join(":");
  const { default: chromium } = await import("@sparticuz/chromium");
  // First, as it unpacks its fonts.conf only while the fonts folder is absent.
  const executablePath = await chromium.executablePath();
  await installFonts();
  const puppeteer = await import("puppeteer-core");
  return puppeteer.launch({
    headless: true,
    args: [...chromium.args, ...args],
    executablePath,
    defaultViewport: viewport,
  });
}
