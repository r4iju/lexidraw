import "server-only";

import { put } from "@vercel/blob";
import env from "@packages/env";
import { RetryableError } from "workflow";
import { thumbnailPathname } from "~/server/entities/thumbnail";

export async function uploadBlobStep(
  entityId: string,
  theme: "light" | "dark",
  data: Uint8Array,
): Promise<string> {
  "use step";

  const pathname = thumbnailPathname(entityId, theme, "webp");
  try {
    const { url } = await put(pathname, new Blob([new Uint8Array(data)]), {
      access: "public",
      contentType: "image/webp",
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    return url;
  } catch (error) {
    throw new RetryableError(
      `Failed to upload blob ${pathname}: ${(error as Error).message}`,
      { retryAfter: 30_000 },
    );
  }
}

uploadBlobStep.maxRetries = 3;
