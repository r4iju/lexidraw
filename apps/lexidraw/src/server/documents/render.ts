import "server-only";

import env from "@packages/env";
import { createPrintToken } from "~/server/auth/print-token";

export const DOCUMENT_RENDER_FORMATS = ["pdf"] as const;
export const PAPER_SIZES = ["A4", "Letter"] as const;
export const ORIENTATIONS = ["portrait", "landscape"] as const;

export type PdfOptions = {
  paper: (typeof PAPER_SIZES)[number];
  orientation: (typeof ORIENTATIONS)[number];
};

/** No page renderer is configured, so there is nothing to print with. */
export class RendererUnavailableError extends Error {
  constructor() {
    super("PDF rendering is not configured on this server");
  }
}

/** The page renderer was reached and could not produce the PDF. */
export class RenderFailedError extends Error {}

function rendererEndpoint(): string | null {
  const base = env.HEADLESS_RENDER_URL?.replace(/\/+$/, "");
  if (base) return `${base}/api/render/pdf`;
  // The worker `turbo dev` runs next to the app.
  if (env.NODE_ENV !== "production")
    return "http://localhost:4025/api/render/pdf";
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
 * Prints a document as the page renderer sees its print page, and returns the
 * PDF. `appOrigin` is where the renderer reaches that page: the origin the
 * request came in on, so the print is made by the deployment that was asked.
 * The page opens on a short-lived token for this document and `userId`, whose
 * access the caller has already checked.
 */
export async function renderDocumentPdf(params: {
  appOrigin: string;
  documentId: string;
  userId: string;
  title: string;
  options: PdfOptions;
}): Promise<Uint8Array> {
  const endpoint = rendererEndpoint();
  if (!endpoint || env.HEADLESS_RENDER_ENABLED === false) {
    throw new RendererUnavailableError();
  }
  const token = createPrintToken({
    userId: params.userId,
    entityId: params.documentId,
  });
  const url = new URL(
    `/documents/${encodeURIComponent(params.documentId)}/print`,
    params.appOrigin,
  );
  url.searchParams.set("token", token);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: url.toString(),
        format: params.options.paper,
        orientation: params.options.orientation,
        margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
        headerTemplate: `<div style="font-size: 8px; width: 100%; padding: 0 14mm; color: #666;">${escapeHtml(params.title)}</div>`,
        waitUntil: "networkidle0",
        timeoutMs: 45_000,
      }),
    });
  } catch (error) {
    throw new RenderFailedError("The page renderer could not be reached", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new RenderFailedError(
      `The page renderer answered ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}
