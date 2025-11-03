import "server-only";

import { createPrintTokenStep } from "./create-print-token-step";
import env from "@packages/env";
import { renderPdfStep } from "./render-pdf-step";
import { uploadPdfBlobStep } from "./upload-pdf-blob-step";

export type PdfExportOptions = {
  format?: "A4" | "Letter";
  orientation?: "portrait" | "landscape";
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
};

export async function generateDocumentPdfWorkflow(
  documentId: string,
  userId: string,
  options: PdfExportOptions = {},
): Promise<{ pdfUrl: string }> {
  "use workflow";

  console.log("[pdf-export][wf] start", {
    documentId,
    userId,
    options,
  });

  // Build print URL with token
  // Normalize base URL - strip any path components from NEXTAUTH_URL
  let appBase: string;
  if (env.NEXTAUTH_URL) {
    try {
      const url = new URL(env.NEXTAUTH_URL);
      appBase = `${url.protocol}//${url.host}`;
    } catch {
      appBase = env.NEXTAUTH_URL.replace(/\/api\/auth.*$/, "").replace(
        /\/$/,
        "",
      );
    }
  } else if (env.VERCEL_URL) {
    appBase = `https://${env.VERCEL_URL}`;
  } else {
    appBase = "http://localhost:3025";
  }
  const token = await createPrintTokenStep(
    userId,
    documentId,
    5 * 60_000, // 5 minutes
  );
  const printUrl = `${appBase}/documents/${encodeURIComponent(documentId)}/print?token=${encodeURIComponent(token)}`;

  console.log("[pdf-export][wf] rendering PDF", {
    documentId,
    printUrl,
  });

  // Render PDF
  const pdfBuffer = await renderPdfStep(printUrl, options);

  console.log("[pdf-export][wf] PDF rendered", {
    documentId,
    pdfBytes: pdfBuffer.byteLength,
  });

  // Upload PDF to blob storage
  const timestamp = Date.now();
  const key = `documents/${documentId}/exports/${timestamp}.pdf`;

  const pdfUrl = await uploadPdfBlobStep(key, pdfBuffer);

  console.log("[pdf-export][wf] PDF uploaded", {
    documentId,
    pdfUrl,
  });

  return { pdfUrl };
}
