import type { Resolve } from "@packages/lib/public-address";
import { type RasterType, rasterTypeOf } from "~/server/documents/raster-type";
import { fetchPublic, type Hop } from "./public-fetch";

/**
 * The picture at `src`, as its bytes say it is, when it is a public raster
 * picture within `maxBytes`; undefined otherwise. It never throws.
 */
export async function readPublicImage(
  src: string,
  {
    resolve,
    hop,
    maxBytes = 5_000_000,
    timeoutMs = 10_000,
  }: {
    resolve?: Resolve;
    hop?: Hop;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<{ bytes: Uint8Array; contentType: RasterType } | undefined> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchPublic(
      src,
      { headers: { accept: "image/*" }, signal },
      { resolve, hop },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return undefined;
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) return undefined;
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const contentType = rasterTypeOf(bytes);
    return contentType && { bytes: new Uint8Array(bytes), contentType };
  } catch {
    return undefined;
  }
}
