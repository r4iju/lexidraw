import fs from "node:fs";
import { put } from "@vercel/blob";

export class BlobService {
  /**
   * Streams a local file to Vercel Blob and returns its public URL.
   * `@vercel/blob` automatically picks up BLOB_READ_WRITE_TOKEN.
   */
  async uploadFile(
    filePath: string,
    key: string,
    contentType: string,
  ): Promise<{ url: string; key: string; contentType: string }> {
    const file = fs.readFileSync(filePath);
    const blob = await put(key, file, {
      access: "public",
      contentType,
      multipart: true,
    });
    return { url: blob.url, key, contentType };
  }
}
