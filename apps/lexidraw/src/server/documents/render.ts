import "server-only";

import env from "@packages/env";
import { createScreenshotToken } from "~/server/auth/screenshot-token";
import {
  MAX_RENDER_PIXELS,
  RenderTooLargeError,
} from "~/server/drawings/render";
import { createPrintToken } from "~/server/auth/print-token";

export const MAX_DOCUMENT_WIDTH = 4096;
export const DOCUMENT_RENDER_FORMATS = ["pdf", "png"] as const;
export const PAPER_SIZES = ["A4", "Letter"] as const;
export const ORIENTATIONS = ["portrait", "landscape"] as const;

export type PdfOptions = {
  paper: (typeof PAPER_SIZES)[number];
  orientation: (typeof ORIENTATIONS)[number];
};

/** No page renderer is configured. */
export class RendererUnavailableError extends Error {
  constructor() {
    super("Document rendering is not configured on this server");
  }
}

/** The page renderer was reached and could not produce the file. */
export class RenderFailedError extends Error {}

function rendererEndpoint(format: "pdf" | "png"): string | null {
  const path = format === "pdf" ? "/api/render/pdf" : "/api/screenshot";
  const base = env.HEADLESS_RENDER_URL?.replace(/\/+$/, "");
  if (base) return `${base}${path}`;
  // The worker `turbo dev` runs next to the app.
  if (env.NODE_ENV !== "production") return `http://localhost:4025${path}`;
  return null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders the page on the deployment asked, with a short-lived token scoped
 * to the document and caller whose read access the route has checked.
 */
export async function renderDocument(params: {
  appOrigin: string;
  documentId: string;
  userId: string;
  title: string;
  options:
    | (PdfOptions & { format: "pdf" })
    | { format: "png"; width: number; theme: "light" | "dark" };
}): Promise<Uint8Array> {
  const endpoint = rendererEndpoint(params.options.format);
  if (!endpoint || env.HEADLESS_RENDER_ENABLED === false) {
    throw new RendererUnavailableError();
  }
  const pdf = params.options.format === "pdf";
  const token = (pdf ? createPrintToken : createScreenshotToken)({
    userId: params.userId,
    entityId: params.documentId,
  });
  const url = new URL(
    pdf
      ? `/documents/${encodeURIComponent(params.documentId)}/print`
      : `/screenshot/view/${encodeURIComponent(params.documentId)}`,
    params.appOrigin,
  );
  url.searchParams.set(pdf ? "token" : "st", token);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: url.toString(),
        ...(params.options.format === "pdf"
          ? {
              format: params.options.paper,
              orientation: params.options.orientation,
              margin: {
                top: "16mm",
                right: "14mm",
                bottom: "16mm",
                left: "14mm",
              },
              headerTemplate: `<div style="font-size: 8px; width: 100%; padding: 0 14mm; color: #666;">${escapeHtml(params.title)}</div>`,
            }
          : {
              viewport: {
                width: params.options.width,
                height: 900,
                deviceScaleFactor: 1,
              },
              theme: params.options.theme,
              image: { type: "png" },
              waitForDocument: true,
              maxPixels: MAX_RENDER_PIXELS,
            }),
        waitUntil: "networkidle0",
        timeoutMs: 45_000,
      }),
    });
  } catch (error) {
    throw new RenderFailedError("The page renderer could not be reached", {
      cause: error,
    });
  }
  if (response.status === 413)
    throw new RenderTooLargeError(await response.text());
  if (!response.ok) {
    throw new RenderFailedError(
      `The page renderer answered ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
