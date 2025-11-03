import "server-only";

import env from "@packages/env";
import { RetryableError } from "workflow";
import type { PdfExportOptions } from "./generate-document-pdf-workflow";

export async function renderPdfStep(
  printUrl: string,
  options: PdfExportOptions = {},
): Promise<Uint8Array> {
  "use step";

  if (!env.HEADLESS_RENDER_ENABLED || !env.HEADLESS_RENDER_URL) {
    throw new RetryableError("HEADLESS_RENDER not configured", {
      retryAfter: 60_000,
    });
  }

  try {
    console.log("[pdf-export][step] calling render endpoint", {
      renderUrl: `${env.HEADLESS_RENDER_URL}/api/render/pdf`,
      printUrl,
    });

    const r = await fetch(`${env.HEADLESS_RENDER_URL}/api/render/pdf`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: printUrl,
        format: options.format ?? "A4",
        orientation: options.orientation ?? "portrait",
        margin: options.margin ?? {
          top: "14mm",
          right: "14mm",
          bottom: "16mm",
          left: "14mm",
        },
        waitUntil: "networkidle0",
        timeoutMs: 30000,
      }),
    });

    console.log("[pdf-export][step] render response", {
      status: r.status,
      ok: r.ok,
    });

    if (!r.ok) {
      const status = r.status;
      const errorText = await r.text().catch(() => "Unknown error");
      console.error("[pdf-export][step] render failed", {
        status,
        errorText,
      });
      // 4xx errors are likely fatal (bad request, not found, etc.)
      if (status >= 400 && status < 500) {
        throw new RetryableError(
          `PDF render failed with status ${status}: ${errorText}`,
          {
            retryAfter: 60_000,
          },
        );
      }
      // 5xx errors are retryable
      throw new RetryableError(`PDF render failed with status ${status}`, {
        retryAfter: 30_000,
      });
    }

    const buf = new Uint8Array(await r.arrayBuffer());
    console.log("[pdf-export][step] PDF received", {
      size: buf.byteLength,
    });
    return buf;
  } catch (error) {
    if (error instanceof RetryableError) {
      throw error;
    }
    // Network errors and other transient issues
    console.error("[pdf-export][step] render error", error);
    throw new RetryableError(`PDF render failed: ${(error as Error).message}`, {
      retryAfter: 30_000,
    });
  }
}

// Increase retries for PDF rendering (can be flaky)
renderPdfStep.maxRetries = 5;
