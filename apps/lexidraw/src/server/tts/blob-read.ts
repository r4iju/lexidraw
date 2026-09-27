import { get } from "@vercel/blob";

/**
 * The JSON at `url`, read from the store's origin with its token, not through
 * its CDN: functions asking the CDN for a blob just written are refused (403)
 * for up to half a minute. `undefined` if the blob is missing or unreadable.
 */
export async function blobJson(url: string): Promise<unknown> {
  const started = Date.now();
  try {
    const blob = await get(url, { access: "public", useCache: false });
    if (blob?.statusCode !== 200) return undefined;
    return await new Response(blob.stream).json();
  } catch (error) {
    console.warn("[tts] blob read failed", {
      url,
      error: String(error),
      ms: Date.now() - started,
    });
    return undefined;
  }
}
