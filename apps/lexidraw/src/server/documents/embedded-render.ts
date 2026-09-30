import { createHash } from "node:crypto";

export type EmbedRenderRequest = {
  node: Record<string, unknown>;
  theme: "light" | "dark";
  width: number;
  fontFamily: string;
  fontSize: number;
};
export type EmbedRenderImage = { svg: string; png: string; width: number; height: number };
export type EmbedRenderResult = EmbedRenderImage & { hash: string };

/** Each deployment owns its cache: renderer, CSS and font changes cannot reuse an older image. */
export function createEmbedRenderer(
  draw: (request: EmbedRenderRequest) => Promise<EmbedRenderImage>,
  revision = process.env.VERCEL_GIT_COMMIT_SHA ?? "embedded-render-v1",
) {
  const cache = new Map<string, Promise<EmbedRenderResult>>();
  let active = 0;
  const waiting: (() => void)[] = [];
  async function boundedDraw(request: EmbedRenderRequest) {
    if (active >= 2) {
      if (waiting.length >= 12) throw new Error("Render queue is full");
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      active++;
    }
    try { return await draw(request); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  let bytes = 0;
  const sizes = new Map<string, number>();
  return async (request: EmbedRenderRequest): Promise<EmbedRenderResult> => {
    const hash = createHash("sha256").update(JSON.stringify([revision, canonical(request)])).digest("hex");
    const hit = cache.get(hash);
    if (hit) {
      cache.delete(hash);
      cache.set(hash, hit);
      return hit;
    }
    const pending = boundedDraw(request).then((image) => {
      const size = Buffer.byteLength(image.svg) + Buffer.byteLength(image.png);
      if (size > 12_000_000 || image.width * image.height > 16_000_000) throw new Error("Rendered embed exceeds the image limit");
      sizes.set(hash, size);
      bytes += size;
      while (bytes > 32_000_000 || cache.size > 128) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        bytes -= sizes.get(oldest) ?? 0;
        sizes.delete(oldest);
        cache.delete(oldest);
      }
      return { ...image, hash };
    }).catch((error: unknown) => {
      if (cache.get(hash) === pending) cache.delete(hash);
      throw error;
    });
    cache.set(hash, pending);
    return pending;
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
