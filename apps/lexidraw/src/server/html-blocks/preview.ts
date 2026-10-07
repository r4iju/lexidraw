import "server-only";
import env from "@packages/env";
import { askRenderWorker } from "../render-worker";
import type {
  HTMLBlockTheme,
  SavedHTMLBlock,
} from "@packages/lexical-nodes/html-block";

/** How a reader sees the block: its column width and the document theme. */
export type BlockView = { width: number; theme: HTMLBlockTheme };

const RETRIES = 4;

function workerBase() {
  const base =
    env.HEADLESS_RENDER_URL?.replace(/\/+$/, "") ??
    (env.NODE_ENV !== "production" ? "http://localhost:4025" : null);
  if (!base || env.HEADLESS_RENDER_ENABLED === false)
    throw new Error("Preview renderer is unavailable");
  return base;
}

/** The worker's Retry-After, capped, or an exponential backoff with jitter. */
function backoff(response: Response, attempt: number) {
  const after = Number(response.headers.get("retry-after"));
  if (Number.isFinite(after) && after >= 0) return Math.min(after, 3) * 1000;
  return 400 * 2 ** attempt + Math.random() * 200;
}

export async function captureBlock(
  block: SavedHTMLBlock,
  view: BlockView,
  {
    signal = AbortSignal.timeout(25000),
    worker = workerBase(),
  }: { signal?: AbortSignal; worker?: string } = {},
) {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await askRenderWorker(
      `${worker}/api/html-block-preview`,
      { source: block, ...view },
      { signal },
    );
    if (response.status !== 503 || attempt >= RETRIES) break;
    await new Promise((resolve) =>
      setTimeout(resolve, backoff(response, attempt)),
    );
    signal.throwIfAborted();
  }
  if (response.status === 503)
    throw new Error("Preview renderer is busy. Run the block to use it.");
  if (response.status === 422) {
    // The worker answers 422 only for the block's own markup or script.
    const reply: unknown = await response.json().catch(() => null);
    const message =
      reply && typeof reply === "object" && "message" in reply
        ? String(reply.message).slice(0, 500)
        : "";
    throw new Error(message || "The block's script failed");
  }
  if (!response.ok)
    throw new Error("Preview renderer is unavailable. Run the block to use it.");
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
