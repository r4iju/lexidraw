import { head } from "@vercel/blob";

/**
 * Whether the store holds the blob at `url`, asked of its API, not its CDN:
 * the CDN, asked for a path before it is written, keeps answering 404 for a
 * while after, so a part made just then would not play. Any failure counts
 * as missing, which at worst makes the blob again.
 */
export async function blobExists(url: string): Promise<boolean> {
  try {
    await head(url);
    return true;
  } catch {
    return false;
  }
}
