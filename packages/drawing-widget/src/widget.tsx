/**
 * The drawing preview, as it runs inside a host's sandbox.
 *
 * The widget is the Excalidraw editor over the MCP Apps bridge: the host hands
 * it the result of a drawing tool, it renders the elements the server stored,
 * and every edit goes back through `put_drawing` on the same connection, with
 * the precondition the last read or write answered. It holds no credentials
 * and opens no sockets — every call is the host's, made on the same
 * authenticated MCP session the model is using.
 */
import "@excalidraw/excalidraw/index.css";
import "./widget.css";

import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { App } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  DRAWING_PREVIEW_META_KEY,
  type DrawingPreviewPayload,
  EXCALIDRAW_ASSET_BASE,
} from "./protocol";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
    /** The scene, for a browser test and for a look from a host's console. */
    excalidrawAPI?: ExcalidrawImperativeAPI;
  }
}

/** Fonts resolve against this; see `protocol.ts`. */
window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_BASE;

/** Long enough that a stroke is one save, short enough to feel live. */
const SAVE_DEBOUNCE_MS = 800;

type Drawing = {
  id: string;
  title: string;
  updatedAt: string;
  elements: readonly Record<string, unknown>[];
};

type Status =
  | { kind: "waiting" }
  | { kind: "loading" }
  | { kind: "clean" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string };

/**
 * A tool's answer, parsed back out of the text it travels as. Both transports
 * answer the same JSON body, so a failure is read by its `code` and never by
 * its message.
 */
type Answer =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: string; message: string };

type ToolResultParams = {
  _meta?: Record<string, unknown>;
  content?: unknown;
  isError?: boolean;
};

const app = new App({ name: "lexidraw-drawing-preview", version: "1.0.0" }, {});

/**
 * The host may deliver the tool result before React has mounted, and the SDK
 * warns about handlers registered after `connect`, so the listener goes on
 * immediately and the newest result waits here for whoever renders.
 */
let latestResult: ToolResultParams | null = null;
let onResult: ((params: ToolResultParams) => void) | null = null;
app.addEventListener("toolresult", (params) => {
  latestResult = params as ToolResultParams;
  onResult?.(latestResult);
});

/**
 * The handshake. It is started here rather than after the first render so the
 * host's context — the theme among it — is available as soon as it answers;
 * `ui/notifications/host-context-changed` only fires on a later change.
 */
const connected = app.connect().catch((error: unknown) => {
  console.error("[lexidraw] the host bridge did not connect", error);
});

/** What went wrong, as a widget can say it. */
function reason(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Tells the model what the user did, where the host lets an app do that. */
async function told(text: string) {
  if (!app.getHostCapabilities()?.updateModelContext) return;
  try {
    await app.updateModelContext({ content: [{ type: "text", text }] });
  } catch (error) {
    console.error("[lexidraw] the host refused the context update", error);
  }
}

function readAnswer(result: unknown): Answer {
  const content = (result as { content?: { text?: string }[] }).content;
  const text = content?.[0]?.text;
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const body = (parsed ?? {}) as Record<string, unknown>;
  if ((result as { isError?: boolean }).isError) {
    return {
      ok: false,
      code: typeof body.code === "string" ? body.code : "UNKNOWN",
      message:
        typeof body.message === "string" ? body.message : "The call failed.",
    };
  }
  return { ok: true, value: body };
}

/** The payload a drawing tool attaches for the widget, when the host kept it. */
function readPayload(params: ToolResultParams): DrawingPreviewPayload | null {
  const payload = params._meta?.[DRAWING_PREVIEW_META_KEY];
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<DrawingPreviewPayload>;
  if (typeof candidate.id !== "string") return null;
  return candidate as DrawingPreviewPayload;
}

/** The elements a read answers with, which its payload leaves out. */
function readElements(
  answer: Answer,
): readonly Record<string, unknown>[] | undefined {
  if (!answer.ok || !Array.isArray(answer.value.elements)) return undefined;
  return answer.value.elements as readonly Record<string, unknown>[];
}

/**
 * What the drawing looks like right now, cheaply. Excalidraw bumps `version`
 * on every mutation, so this changes exactly when the scene does and not when
 * a pointer moves over it.
 */
function signature(elements: readonly { id: string; version: number }[]) {
  return elements
    .map((element) => `${element.id}:${element.version}`)
    .join(",");
}

/** The scene as a write: deleted elements are gone, not tombstoned. */
function live(elements: readonly ExcalidrawElement[]) {
  return elements.filter((element) => !element.isDeleted);
}

function Widget() {
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "waiting" });
  const [readOnly, setReadOnly] = useState(false);
  /** An edit the server has not taken yet, so the header can offer a retry. */
  const [unsaved, setUnsaved] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(
    () => app.getHostContext()?.theme ?? "light",
  );

  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const revision = useRef<string | null>(null);
  const baseline = useRef<string | null>(null);
  const pending = useRef<readonly Record<string, unknown>[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  /** The id a load is in flight for, so one cannot start another. */
  const loading = useRef<string | null>(null);

  /** Puts a scene on screen without treating it as an edit to save back. */
  const show = useCallback((next: Drawing) => {
    revision.current = next.updatedAt;
    baseline.current = null;
    pending.current = null;
    setDrawing((current) => {
      if (current?.id === next.id) {
        api.current?.updateScene({
          elements: next.elements as ExcalidrawElement[],
        });
      }
      return next;
    });
  }, []);

  const load = useCallback(
    async (id: string): Promise<boolean> => {
      // The only call this widget makes other than a save, and never from
      // inside itself: a load that failed is reported, not retried here.
      if (loading.current !== null) return false;
      loading.current = id;
      try {
        const answer = readAnswer(
          await app.callServerTool({ name: "get_drawing", arguments: { id } }),
        );
        if (!answer.ok) {
          setStatus({ kind: "error", message: answer.message });
          return false;
        }
        show({
          id,
          title: String(answer.value.title ?? "Drawing"),
          updatedAt: String(answer.value.updatedAt),
          elements: (answer.value.elements ?? []) as readonly Record<
            string,
            unknown
          >[],
        });
        return true;
      } catch (error) {
        // The host answers this call, and a host can refuse it, drop it, or
        // close the bridge under it; none of those reach the branch above.
        setStatus({
          kind: "error",
          message: `The drawing could not be loaded: ${reason(error)}`,
        });
        return false;
      } finally {
        loading.current = null;
      }
    },
    [show],
  );

  /** Holds on to an edit the server did not take, for a retry. */
  const keep = useCallback((elements: readonly Record<string, unknown>[]) => {
    pending.current = elements;
    setUnsaved(true);
  }, []);

  const save = useCallback(async () => {
    if (saving.current) return;
    const elements = pending.current;
    const id = drawing?.id;
    const ifUnmodifiedSince = revision.current;
    if (!elements || !id || !ifUnmodifiedSince) return;
    pending.current = null;
    saving.current = true;
    // Whether the edit is back in `pending` because the server did not take
    // it, which is what tells the loop below not to send it straight again.
    let kept = false;
    setStatus({ kind: "saving" });
    try {
      const answer = readAnswer(
        await app.callServerTool({
          name: "put_drawing",
          arguments: { id, elements, ifUnmodifiedSince },
        }),
      );
      if (answer.ok) {
        revision.current = String(answer.value.updatedAt);
        setUnsaved(false);
        setStatus({ kind: "saved" });
        // The model read these elements when the tool answered; without this
        // it would go on reasoning about the drawing as it was.
        void told(
          `The user edited drawing ${id} in the preview. It now holds ${elements.length} elements and its updatedAt is ${revision.current}; pass that as ifUnmodifiedSince.`,
        );
        return;
      }
      if (answer.code === "FORBIDDEN") {
        setReadOnly(true);
        // There is nothing to retry: this connection will never take a write.
        setUnsaved(false);
        setStatus({
          kind: "error",
          message: "This connection may only read. Editing is off.",
        });
        return;
      }
      if (answer.code === "CONFLICT") {
        setUnsaved(false);
        const reloaded = await load(id);
        if (reloaded) {
          setStatus({
            kind: "conflict",
            message:
              "The drawing changed elsewhere while you were editing. Your changes were not saved; this is the current version.",
          });
        }
        return;
      }
      keep(elements);
      kept = true;
      setStatus({ kind: "error", message: answer.message });
    } catch (error) {
      // The host makes this call on the widget's behalf and can refuse it,
      // time it out, or close the bridge under it. None of that reaches the
      // branches above, and the edit is only in this widget: dropping it here
      // would lose the user's work silently and leave the header at "Saving…".
      keep(elements);
      kept = true;
      setStatus({
        kind: "error",
        message: `The edit was not saved: ${reason(error)}`,
      });
    } finally {
      saving.current = false;
      if (pending.current && !kept) void save();
    }
  }, [drawing?.id, keep, load]);

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      if (readOnly || !drawing) return;
      const scene = live(elements);
      const current = signature(scene);
      // The editor restores a scene as it opens it, so the first change after
      // a load is the editor's own and not the user's.
      if (baseline.current === null) {
        baseline.current = current;
        return;
      }
      if (current === baseline.current) return;
      baseline.current = current;
      pending.current = scene as unknown as Record<string, unknown>[];
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    },
    [drawing, readOnly, save],
  );

  useEffect(() => {
    const handle = (params: ToolResultParams) => {
      const payload = readPayload(params);
      if (!payload) {
        // A host that does not forward `_meta` leaves the id in the text the
        // model reads, which is enough to load the drawing over the bridge.
        const answer = readAnswer(params);
        const id = answer.ok ? answer.value.id : null;
        if (typeof id !== "string") return;
        setStatus({ kind: "loading" });
        void load(id).then((ok) => ok && setStatus({ kind: "clean" }));
        return;
      }
      setReadOnly(!payload.canWrite);
      if (payload.elements === null) {
        setStatus({
          kind: "error",
          message: payload.tooLarge
            ? "This drawing is too large to preview here. Open it in Lexidraw."
            : "This drawing could not be loaded.",
        });
        return;
      }
      // A read leaves its elements out of the payload because its own answer
      // carries them; a write's answer carries counts, so its payload does.
      const elements = payload.elements ?? readElements(readAnswer(params));
      if (!elements) {
        setStatus({ kind: "loading" });
        void load(payload.id).then((ok) => ok && setStatus({ kind: "clean" }));
        return;
      }
      show({
        id: payload.id,
        title: payload.title,
        updatedAt: payload.updatedAt,
        elements,
      });
      setStatus({ kind: "clean" });
    };
    onResult = handle;
    if (latestResult) handle(latestResult);
    return () => {
      onResult = null;
    };
  }, [load, show]);

  useEffect(() => {
    let mounted = true;
    // The host's context arrives with the handshake, which is almost always
    // later than the first render, and the notification below only fires on a
    // change after that — so the first theme comes from the handshake itself.
    void connected.then(() => {
      if (mounted) setTheme(app.getHostContext()?.theme ?? "light");
    });
    const onContext = () => setTheme(app.getHostContext()?.theme ?? "light");
    app.addEventListener("hostcontextchanged", onContext);
    return () => {
      mounted = false;
      app.removeEventListener("hostcontextchanged", onContext);
    };
  }, []);

  useEffect(() => {
    api.current?.updateScene({ appState: { theme } });
  }, [theme]);

  return (
    <div className={`widget ${theme}`}>
      <header>
        <span className="title">{drawing?.title ?? "Drawing"}</span>
        <StatusLabel status={status} readOnly={readOnly} />
        {unsaved && !readOnly ? (
          <button
            type="button"
            className="retry"
            data-testid="retry"
            onClick={() => void save()}
          >
            Retry
          </button>
        ) : null}
      </header>
      <div className="canvas">
        {drawing ? (
          <Excalidraw
            key={drawing.id}
            initialData={{
              elements: drawing.elements as ExcalidrawElement[],
              appState: { theme, viewBackgroundColor: "#ffffff" },
              scrollToContent: true,
            }}
            viewModeEnabled={readOnly}
            excalidrawAPI={(instance) => {
              api.current = instance;
              window.excalidrawAPI = instance;
            }}
            onChange={onChange}
            // Everything the sandbox cannot carry out: opening and saving a
            // file reach a file system the app document has none of, and
            // exporting an image fetches subsetted fonts and a wasm encoder
            // from origins `_meta.ui.csp` does not name — widening the policy
            // for them would be granting the widget more than it needs.
            // Images are binary files, which `put_drawing` does not carry, so
            // one placed here would vanish on the next save.
            UIOptions={{
              canvasActions: {
                export: false,
                loadScene: false,
                saveAsImage: false,
                saveToActiveFile: false,
                toggleTheme: false,
              },
              tools: { image: false },
            }}
          />
        ) : (
          <p className="empty">
            {status.kind === "error"
              ? status.message
              : "Waiting for a drawing…"}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusLabel({
  status,
  readOnly,
}: {
  status: Status;
  readOnly: boolean;
}) {
  const label =
    status.kind === "saving"
      ? "Saving…"
      : status.kind === "saved"
        ? "Saved"
        : status.kind === "loading"
          ? "Loading…"
          : status.kind === "conflict"
            ? "Reloaded"
            : status.kind === "error"
              ? "Problem"
              : readOnly
                ? "Read-only"
                : "";
  const detail =
    status.kind === "conflict" || status.kind === "error"
      ? status.message
      : readOnly && status.kind !== "saving"
        ? "This connection may only read."
        : "";
  return (
    <span
      className={`status ${status.kind}`}
      data-testid="status"
      title={detail}
    >
      {label}
      {detail ? <span className="detail">{detail}</span> : null}
    </span>
  );
}

const container = document.getElementById("root");
if (container) createRoot(container).render(<Widget />);
