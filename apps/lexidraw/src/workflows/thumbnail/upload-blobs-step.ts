import "server-only";

import { put } from "@vercel/blob";
import env from "@packages/env";
import { RetryableError } from "workflow";

export async function uploadBlobStep(
  key: string,
  data: Uint8Array,
): Promise<string> {
  "use step";

  try {
    // Determine content type from file extension
    const contentType = key.endsWith(".png")
      ? "image/png"
      : key.endsWith(".webp")
        ? "image/webp"
        : "image/webp"; // default fallback

    const { url } = await put(key, new Blob([new Uint8Array(data)]), {
      access: "public",
      contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return url;
  } catch (error) {
    throw new RetryableError(
      `Failed to upload blob ${key}: ${(error as Error).message}`,
      { retryAfter: 30_000 },
    );
  }
}

uploadBlobStep.maxRetries = 3;
