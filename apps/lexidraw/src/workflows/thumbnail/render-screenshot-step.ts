import "server-only";

import env from "@packages/env";
import { RetryableError } from "workflow";

export async function renderScreenshotStep(
  pageUrl: string,
  theme: "light" | "dark",
): Promise<Uint8Array> {
  "use step";

  if (!env.HEADLESS_RENDER_ENABLED || !env.HEADLESS_RENDER_URL) {
    throw new RetryableError("HEADLESS_RENDER not configured", {
      retryAfter: 60_000,
    });
  }

  const targetW = 640;
  const targetH = 480;

  try {
    const r = await fetch(`${env.HEADLESS_RENDER_URL}/api/screenshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: pageUrl,
        selector: `#screenshot-root`,
        viewport: { width: targetW, height: targetH, deviceScaleFactor: 2 },
        image: { type: "webp", quality: 92 },
        waitUntil: "networkidle2",
        timeoutMs: 15000,
        theme,
      }),
    });

    if (!r.ok) {
      const status = r.status;
      // 4xx errors are likely fatal (bad request, not found, etc.)
      if (status >= 400 && status < 500) {
        throw new RetryableError(
          `screenshot ${theme} failed with status ${status}`,
          {
            retryAfter: 60_000,
          },
        );
      }
      // 5xx errors are retryable
      throw new RetryableError(
        `screenshot ${theme} failed with status ${status}`,
        {
          retryAfter: 30_000,
        },
      );
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    return buf;
  } catch (error) {
    if (error instanceof RetryableError) {
      throw error;
    }
    // Network errors and other transient issues
    throw new RetryableError(
      `screenshot ${theme} failed: ${(error as Error).message}`,
      {
        retryAfter: 30_000,
      },
    );
  }
}

// Increase retries for screenshot rendering (can be flaky)
renderScreenshotStep.maxRetries = 5;
