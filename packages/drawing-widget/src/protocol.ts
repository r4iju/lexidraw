/**
 * What the MCP server and the widget agree on: where the widget's data travels
 * and what it is allowed to load. Both halves import this file, and
 * `scripts/build.ts` copies every value here into the generated `dist/index.js`
 * so the server reads the same constants the bundle was built with.
 */

/** The pinned editor. `scripts/build.ts` refuses a bundle built against another. */
export const EXCALIDRAW_VERSION = "0.18.1";

/**
 * Where the editor's fonts come from at runtime.
 *
 * Excalidraw resolves font files against `window.EXCALIDRAW_ASSET_PATH`, and
 * falls back to this same esm.sh path when it is unset. The widget sets it
 * explicitly because a sandboxed app document has no origin a relative path
 * could resolve against, and because the origin has to match
 * {@link DRAWING_PREVIEW_CSP} — a font the CSP refuses is a silently wrong
 * text layout, not an error anyone sees.
 */
export const EXCALIDRAW_ASSET_BASE = `https://esm.sh/@excalidraw/excalidraw@${EXCALIDRAW_VERSION}/dist/prod/`;

/**
 * The domains the widget asks the host to allow, as `_meta.ui.csp`.
 *
 * Fonts only. The widget talks to the server through the host bridge over
 * `postMessage`, never over the network, so it needs no `connectDomains`.
 */
export const DRAWING_PREVIEW_CSP = {
  resourceDomains: ["https://esm.sh"],
  connectDomains: [] as string[],
};

/**
 * The `_meta` key carrying the drawing a tool result is about.
 *
 * A tool result reaches the widget as an MCP Apps `ui/notifications/tool-result`
 * notification, whose params are the whole `CallToolResult` — `_meta` included.
 * The elements ride there rather than in `content` because `content` is what
 * the model reads, and the model just sent those elements; repeating them back
 * would double the cost of every write for a payload only the widget uses.
 */
export const DRAWING_PREVIEW_META_KEY = "app.lexidraw/drawing";

/** The URI the widget is registered under. */
export const DRAWING_PREVIEW_URI = "ui://lexidraw/drawing-preview";

/**
 * What a drawing tool attaches for the widget under
 * {@link DRAWING_PREVIEW_META_KEY}.
 *
 * `elements` is null when the drawing is too large to carry (the widget then
 * says so rather than rendering half a scene). A host that drops `_meta`
 * leaves the widget with no payload at all, and it loads the drawing with
 * `get_drawing` instead, so this is a fast path and not the only one.
 */
export type DrawingPreviewPayload = {
  id: string;
  title: string;
  /** The precondition the widget passes to its next `put_drawing`. */
  updatedAt: string;
  /** The stored elements, as the server normalized them. */
  elements: readonly Record<string, unknown>[] | null;
  /** False for a read-scope token: the widget opens read-only. */
  canWrite: boolean;
  /** Set when `elements` was dropped for size. */
  tooLarge?: true;
};
