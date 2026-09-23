import {
  RESOURCE_MIME_TYPE,
  getUiCapability,
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
      // not on the requests that only call a tool. The module cache is the
      // memoisation — the document is one string literal in a module, built
      // once per instance and read by reference on every later request.
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
 * Whether this connection has any use for a preview payload.
 *
 * MCP Apps is negotiated as a client capability, so a plain client can be told
 * apart from a host that renders widgets — and a plain client is then charged
 * nothing for one. This endpoint is stateless, though: every request builds its
 * own server, and a `tools/call` arriving on its own carries no memory of the
 * `initialize` that named those capabilities. Unknown therefore means yes,
 * because the alternative is a host silently receiving no drawing to render.
 */
export function wantsPreview(
  capabilities: Parameters<typeof getUiCapability>[0],
): boolean {
  if (!capabilities) return true;
  return getUiCapability(capabilities) !== undefined;
}

/** The same, for the server a tool is running on. */
function serverWantsPreview(server: McpServer): boolean {
  return wantsPreview(server.server.getClientCapabilities());
}

/**
 * The `_meta` a read answers with: the drawing, without its elements.
 *
 * A read's own `content` is the whole drawing, and the widget takes the
 * elements from there; sending them here as well would put the same array on
 * the wire twice, under two separate ceilings.
 */
export async function readPreviewMeta(
  server: McpServer,
  caller: RouterCaller,
  drawing: Omit<StoredDrawing, "elements">,
): Promise<Record<string, unknown> | undefined> {
  if (!serverWantsPreview(server)) return undefined;
  const payload: DrawingPreviewPayload = {
    id: drawing.id,
    title: drawing.title,
    updatedAt: drawing.updatedAt,
    canWrite: await hasWriteScope(caller),
  };
  return { [DRAWING_PREVIEW_META_KEY]: payload };
}

/**
 * The `_meta` a write answers with, from a drawing already read.
 *
 * A write answers with counts rather than elements, so this is where the
 * widget gets a scene at all. It rides in `_meta` rather than in the tool's
 * text because `content` is what the model reads, and a model that just sent
 * these elements has no use for them back. A host that drops `_meta` costs the
 * widget one `get_drawing` over the bridge and nothing else.
 */
async function writePreviewMeta(
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
 * The write payload, for a write that answered with an id.
 *
 * The drawing is read back so the widget is shown what the server stored, not
 * what the caller sent: a skeleton payload is expanded and restored on the way
 * in, and the preview is how that is seen. That read is the reason this is
 * gated on {@link wantsPreview} — a client that renders nothing pays for
 * nothing. A failure here answers with no payload at all: a preview is never
 * the reason a write reports itself as failed.
 */
export async function loadDrawingPreviewMeta(
  server: McpServer,
  caller: RouterCaller,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  if (!serverWantsPreview(server)) return undefined;
  try {
    return await writePreviewMeta(caller, await caller.drawings.get({ id }));
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
