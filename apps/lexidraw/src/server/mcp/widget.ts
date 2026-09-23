import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  DRAWING_PREVIEW_CSP,
  DRAWING_PREVIEW_META_KEY,
  DRAWING_PREVIEW_URI,
  type DrawingPreviewPayload,
} from "@packages/drawing-widget";

import type { RouterCaller } from "./tools";

/**
 * The drawing preview as an MCP Apps resource: a `ui://` document a host
 * renders in the chat when one of the drawing tools answers, and which then
 * talks back to this same endpoint through the host.
 *
 * The widget is ours. `excalidraw/excalidraw-mcp` publishes a comparable one
 * but carries no LICENSE file, so none of its code is reused here; this one is
 * built on the MIT-licensed `@excalidraw/excalidraw` package the app already
 * renders with, which is also why an edit in the preview is a real Excalidraw
 * edit. See docs/agent-access.md.
 */

/** What a tool carries so a host knows which document renders its result. */
export const DRAWING_PREVIEW_TOOL_META = {
  ui: { resourceUri: DRAWING_PREVIEW_URI },
};

/** The `_meta.ui` a host reads before it renders, and again as it renders. */
const RESOURCE_UI_META = { ui: { csp: DRAWING_PREVIEW_CSP } };

/**
 * A drawing the widget cannot be handed. The ceiling is the one a read answers
 * under, because this payload rides on the same response: past it the widget
 * is told the drawing is too large rather than shown half of it.
 */
const MAX_PREVIEW_BYTES = 1_000_000;

export function registerDrawingPreview(server: McpServer): void {
  registerAppResource(
    server,
    "Drawing preview",
    DRAWING_PREVIEW_URI,
    {
      description:
        "The Excalidraw editor for a drawing a tool just created, read, or wrote, rendered in the conversation. Edits in it are saved through put_drawing on this connection.",
      _meta: RESOURCE_UI_META,
    },
    async () => {
      // Five megabytes of bundled editor: loaded when a host asks for it and
      // not on the requests that only call a tool.
      const { DRAWING_PREVIEW_HTML } = await import(
        "@packages/drawing-widget/html"
      );
      return {
        contents: [
          {
            uri: DRAWING_PREVIEW_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: DRAWING_PREVIEW_HTML,
          },
        ],
        _meta: RESOURCE_UI_META,
      };
    },
  );
}

type StoredDrawing = {
  id: string;
  title: string;
  updatedAt: string;
  elements: readonly Record<string, unknown>[];
};

/**
 * The `_meta` a drawing tool answers with, from a drawing already read.
 *
 * It rides in `_meta` rather than in the tool's text because `content` is what
 * the model reads, and a model that just sent these elements has no use for
 * them back; the widget does. A host that drops `_meta` costs the widget one
 * `get_drawing` over the bridge and nothing else.
 */
export async function drawingPreviewMeta(
  caller: RouterCaller,
  drawing: StoredDrawing,
): Promise<Record<string, unknown>> {
  const canWrite = await hasWriteScope(caller);
  const payload: DrawingPreviewPayload = {
    id: drawing.id,
    title: drawing.title,
    updatedAt: drawing.updatedAt,
    elements: drawing.elements,
    canWrite,
  };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PREVIEW_BYTES) {
    return {
      [DRAWING_PREVIEW_META_KEY]: {
        ...payload,
        elements: null,
        tooLarge: true,
      } satisfies DrawingPreviewPayload,
    };
  }
  return { [DRAWING_PREVIEW_META_KEY]: payload };
}

/**
 * The same, for a write, which answers with an id rather than with elements.
 *
 * The widget is shown what the server stored, not what the caller sent: a
 * skeleton payload is expanded and restored on the way in, and the preview is
 * how that is seen. A failure here answers with no payload at all — a preview
 * is never the reason a write reports itself as failed.
 */
export async function loadDrawingPreviewMeta(
  caller: RouterCaller,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await drawingPreviewMeta(caller, await caller.drawings.get({ id }));
  } catch (error) {
    console.error("❌ MCP drawing preview failed:", error);
    return undefined;
  }
}

/** Whether this connection may write; a read-scope token opens the widget read-only. */
async function hasWriteScope(caller: RouterCaller): Promise<boolean> {
  const me = await caller.auth.me({});
  return me.scope !== "read";
}
