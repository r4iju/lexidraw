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

/**
 * A block's saved-state preview, or why there is none: its own script failed
 * (the author can fix it) or the renderer could not capture it (Run still works).
 */
export type BlockCapture =
  | { status: "ready"; data: string; scale: number }
  | { status: "failed"; reason: "script" | "unavailable"; message: string };

const UNAVAILABLE = {
  status: "failed",
  reason: "unavailable",
  message: "Saved-state preview unavailable. Run the block to use it.",
} as const;

export async function captureBlock(
  block: SavedHTMLBlock,
  view: BlockView,
  options: { signal?: AbortSignal; worker?: string } = {},
): Promise<BlockCapture> {
  try {
    return await ask(block, view, options);
  } catch {
    return UNAVAILABLE;
  }
}

async function ask(
  block: SavedHTMLBlock,
  view: BlockView,
  {
    signal = AbortSignal.timeout(25000),
    worker = workerBase(),
  }: { signal?: AbortSignal; worker?: string },
): Promise<BlockCapture> {
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
  if (response.status === 422) {
    // The worker answers 422 only for the block's own markup or script.
    const reply: unknown = await response.json().catch(() => null);
    const message =
      reply && typeof reply === "object" && "message" in reply
        ? String(reply.message).slice(0, 500)
        : "";
    return {
      status: "failed",
      reason: "script",
      message: message || "The block's script failed",
    };
  }
  if (!response.ok) return UNAVAILABLE;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.byteLength > 4 * 1024 * 1024 ||
    bytes.length < 24 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    ) ||
    bytes.toString("latin1", 12, 16) !== "IHDR"
  )
    return UNAVAILABLE;
  // The worker captures at a higher pixel density than layout pixels; clients size the image by the latter.
  const scale = bytes.readUInt32BE(16) / view.width;
  if (!Number.isInteger(scale) || scale < 1 || scale > 3) return UNAVAILABLE;
  return { status: "ready", data: bytes.toString("base64"), scale };
}
