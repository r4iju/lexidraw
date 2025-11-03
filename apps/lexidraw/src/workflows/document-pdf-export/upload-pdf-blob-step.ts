import "server-only";

import { put } from "@vercel/blob";
import env from "@packages/env";
import { RetryableError } from "workflow";

export async function uploadPdfBlobStep(
  key: string,
  data: Uint8Array,
): Promise<string> {
  "use step";

  try {
    // Convert Uint8Array to Buffer for Vercel Blob (which expects Buffer in Node.js)
    const buffer = Buffer.from(data);
    const { url } = await put(key, buffer, {
      access: "public",
      contentType: "application/pdf",
      token: env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return url;
  } catch (error) {
    throw new RetryableError(
      `Failed to upload PDF blob ${key}: ${(error as Error).message}`,
      { retryAfter: 30_000 },
    );
  }
}

uploadPdfBlobStep.maxRetries = 3;
