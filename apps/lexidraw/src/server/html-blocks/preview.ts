import "server-only";
import env from "@packages/env";
import { askRenderWorker } from "../render-worker";
import type { SavedHTMLBlock } from "@packages/lexical-nodes/html-block";
export async function captureBlock(
  block: SavedHTMLBlock,
  width: number,
  signal?: AbortSignal,
) {
  const base =
    env.HEADLESS_RENDER_URL?.replace(/\/+$/, "") ??
    (env.NODE_ENV !== "production" ? "http://localhost:4025" : null);
  if (!base || env.HEADLESS_RENDER_ENABLED === false)
    throw new Error("Preview renderer is unavailable");
  const response = await askRenderWorker(
    `${base}/api/html-block-preview`,
    { source: block, width },
    { signal: signal ?? AbortSignal.timeout(25000) },
  );
  if (response.status === 503)
    throw new Error(
      "Preview renderer is busy. Reload the document to retry, or Run the block.",
    );
  if (!response.ok)
    throw new Error(
      "HTML block could not produce a saved-state preview. Check supported markup and blockReady().",
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.byteLength > 4 * 1024 * 1024 ||
    bytes.length < 8 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    throw new Error("Invalid preview image");
  return Buffer.from(bytes).toString("base64");
}
