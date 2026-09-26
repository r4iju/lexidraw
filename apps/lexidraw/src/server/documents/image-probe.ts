import type { Resolve } from "@packages/lib/public-address";
import type { NaturalSize } from "@packages/lexical-nodes";
import { fetchPublic, type Hop } from "~/server/net/public-fetch";
import { imageSizeOf } from "./image-size";

type Options = {
  resolve?: Resolve;
  hop?: Hop;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

/**
 * The size of the picture at `src`, read from its first bytes, or undefined
 * when it cannot be had within the time and bytes allowed, or from where a
 * server may not reach. It never throws.
 */
export async function probeImageSize(
  src: string,
  {
    resolve,
    hop,
    timeoutMs = 3000,
    maxBytes = 128 * 1024,
    maxRedirects = 2,
  }: Options = {},
): Promise<NaturalSize | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const expired = new Promise<undefined>((settle) =>
    controller.signal.addEventListener("abort", () => settle(undefined)),
  );
  const probed = async () => {
    const response = await fetchPublic(
      src,
      {
        headers: { accept: "image/*", "user-agent": "Lexidraw image size" },
        signal: controller.signal,
      },
      { resolve, hop, maxRedirects },
    );
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return undefined;
    }
    return readSize(response.body, maxBytes, controller.signal);
  };
  try {
    return await Promise.race([probed(), expired]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function readSize(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
) {
  const reader = body.getReader();
  let bytes = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      const joined = new Uint8Array(bytes.length + value.length);
      joined.set(bytes);
      joined.set(value, bytes.length);
      bytes = joined.subarray(0, maxBytes);
      const size = imageSizeOf(bytes);
      if (size || bytes.length >= maxBytes) return size;
    }
    return signal.aborted ? undefined : imageSizeOf(bytes);
  } finally {
    await reader.cancel();
  }
}
