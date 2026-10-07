"use client";
import {
  HTMLBlockNode as HeadlessHTMLBlockNode,
  SavedHTMLBlockSchema,
  snapshotDocument,
  type HTMLBlockTheme,
  type SavedHTMLBlock,
} from "@packages/lexical-nodes";
import { keepPreviousData } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { useHTMLBlockPreviews } from "../HTMLBlockPreviews";
export class HTMLBlockNode extends HeadlessHTMLBlockNode {
  $config() {
    return this.config("html-block", { extends: HeadlessHTMLBlockNode });
  }
  decorate() {
    return (
      <HTMLBlockView key={JSON.stringify(this.__block)} stored={this.__block} />
    );
  }
}
function HTMLBlockView({ stored }: { stored: unknown }) {
  const parsed = SavedHTMLBlockSchema.safeParse(stored);
  if (!parsed.success)
    return <p role="status">HTML block content is unavailable.</p>;
  return <SavedBlock block={parsed.data} />;
}
/** The document theme the reader sees, once the theme provider has resolved it. */
function useReaderTheme(): HTMLBlockTheme | undefined {
  const { resolvedTheme, forcedTheme } = useTheme();
  const theme = forcedTheme ?? resolvedTheme;
  return theme === "dark" || theme === "light" ? theme : undefined;
}
/**
 * The frame's width in layout pixels, within what the renderer captures. Later
 * changes settle before they are reported, so resizing a window asks for one
 * capture rather than one per frame.
 */
function useFrameWidth() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>();
  // The frame's size is an external value only a ResizeObserver reports.
  useEffect(() => {
    if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let first = true;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const next = Math.min(
        1280,
        Math.max(240, Math.round(entry.contentRect.width)),
      );
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(next), first ? 0 : 300);
      first = false;
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [element]);
  return [setElement, width] as const;
}
function SavedBlock({ block }: { block: SavedHTMLBlock }) {
  const params = useParams<{ documentId?: string; id?: string }>();
  const documentId = params.documentId ?? params.id ?? "";
  const supplied = useHTMLBlockPreviews();
  const theme = useReaderTheme();
  const [frame, width] = useFrameWidth();
  const preview = api.htmlBlocks.preview.useQuery(
    {
      id: documentId,
      blockId: block.id,
      revision: block.revision,
      width: width ?? 800,
      theme: theme ?? "light",
    },
    {
      enabled:
        supplied === null &&
        Boolean(documentId) &&
        width !== undefined &&
        theme !== undefined,
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      placeholderData: keepPreviousData,
    },
  );
  const utils = api.useUtils();
  const [run, setRun] = useState<
    | { phase: "preview" }
    | { phase: "starting"; attempt: number }
    | { phase: "running"; attempt: number }
    | { phase: "failed"; message: string }
  >({ phase: "preview" });
  const current = api.htmlBlocks.get.useQuery(
    { id: documentId, blockId: block.id },
    {
      enabled: run.phase === "running" && supplied === null,
      retry: false,
      refetchInterval: 5000,
      staleTime: 0,
    },
  );
  const invalidated =
    run.phase === "running" &&
    (current.isError ||
      (current.data !== undefined &&
        current.data.block.revision !== block.revision));
  const latestAttempt = useRef(0);
  const snapshot = supplied?.[block.id] ?? preview.data;
  const matching =
    !invalidated && snapshot?.revision === block.revision
      ? snapshot
      : undefined;
  async function start() {
    const attempt = ++latestAttempt.current;
    setRun({ phase: "starting", attempt });
    try {
      const saved = await utils.htmlBlocks.get.fetch(
        { id: documentId, blockId: block.id },
        { staleTime: 0 },
      );
      if (attempt !== latestAttempt.current) return;
      if (saved.block.revision !== block.revision)
        throw new Error(
          "This block changed. Reload the document before running it.",
        );
      setRun({ phase: "running", attempt });
    } catch (error) {
      if (attempt === latestAttempt.current)
        setRun({
          phase: "failed",
          message: error instanceof Error ? error.message : "Block unavailable",
        });
    }
  }
  const image =
    matching?.status === "ready" ? (
      <img
        src={`data:image/png;base64,${matching.data}`}
        alt={`${block.description}, saved starting state`}
        width={matching.width}
        height={matching.height}
        className="block h-auto w-full"
      />
    ) : null;
  return (
    <section
      id={`html-block-${block.id}`}
      aria-label={block.description}
      className="my-4 w-full overflow-hidden rounded-lg border border-border"
      contentEditable={false}
    >
      <div
        ref={frame}
        className="relative overflow-hidden"
        style={
          // An exported preview was captured at paper width, so it keeps that shape in any column.
          supplied === null
            ? { height: block.height }
            : { aspectRatio: `${snapshot?.width ?? 800} / ${block.height}` }
        }
      >
        {run.phase === "running" && !invalidated && supplied === null ? (
          <RunningBlock
            key={`${run.attempt}:${theme}`}
            block={block}
            theme={theme ?? "light"}
            backdrop={image}
          />
        ) : image ? (
          image
        ) : matching?.status === "failed" && matching.reason === "script" ? (
          <ScriptError message={matching.message} />
        ) : (
          <p
            role="status"
            className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground"
          >
            {matching?.status === "failed" || preview.isError
              ? "Saved-state preview unavailable. Run still works."
              : "Preparing saved-state preview…"}
          </p>
        )}
      </div>
      {supplied === null && (
        <div className="flex flex-wrap items-center gap-3 border-t p-3 print:hidden">
          <Button
            type="button"
            variant="outline"
            disabled={run.phase === "starting"}
            onClick={() => void start()}
            aria-label={`${run.phase === "running" ? "Restart" : "Run"} ${block.description}`}
          >
            {run.phase === "starting"
              ? "Starting…"
              : run.phase === "running"
                ? "Restart"
                : "Run"}
          </Button>
          <span className="text-sm text-muted-foreground" role="status">
            {invalidated
              ? "This block changed or access ended. Reload the document before running it again."
              : run.phase === "failed"
                ? run.message
                : "Interactions are private to this view and reset on restart."}
          </span>
        </div>
      )}
    </section>
  );
}
/** The block's own script failed: the author can act on its message, so it is shown in full. */
function ScriptError({ message }: { message: string }) {
  return (
    <div role="status" className="flex h-full items-center justify-center p-4">
      <div className="max-h-full max-w-full overflow-auto rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
        <p className="font-medium text-destructive">Script error</p>
        <p className="mt-1 whitespace-pre-wrap break-words font-mono text-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}
function RunningBlock({
  block,
  theme,
  backdrop,
}: {
  block: SavedHTMLBlock;
  theme: HTMLBlockTheme;
  /** Shown until the block has started, so pressing Run does not flash an empty frame. */
  backdrop: ReactNode;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready" }
    | { status: "failed"; message: string }
  >({ status: "loading" });
  // The iframe DOM and interpreter are external resources disposed on restart or source change.
  useEffect(() => {
    let cancelled = false;
    let begun = false;
    let running: { dispose(): void } | undefined;
    const element = frame.current;
    const start = async () => {
      const body = element?.contentDocument?.body;
      if (!body || begun) return;
      begun = true;
      try {
        const { prepareHTML, startHTMLBlock } = await import(
          "@packages/lexical-nodes/html-block/runtime"
        );
        if (cancelled) return;
        prepareHTML(body, block.html);
        const interpreter = await startHTMLBlock(body, block, (message) =>
          setState({ status: "failed", message }),
        );
        if (cancelled) {
          interpreter.dispose();
          return;
        }
        running = interpreter;
        setState({ status: "ready" });
      } catch (error) {
        if (!cancelled)
          setState({
            status: "failed",
            message:
              error instanceof Error ? error.message : "Block could not start",
          });
      }
    };
    const loaded = () => void start();
    element?.addEventListener("load", loaded);
    if (
      element?.contentDocument?.URL === "about:srcdoc" &&
      element.contentDocument.readyState === "complete"
    )
      void start();
    return () => {
      cancelled = true;
      element?.removeEventListener("load", loaded);
      running?.dispose();
    };
  }, [block]);
  return (
    <>
      {state.status === "failed" ? (
        <ScriptError message={state.message} />
      ) : (
        state.status === "loading" && (
          <div className="absolute inset-0">
            {backdrop}
            <span role="status" className="sr-only">
              Loading interactive block…
            </span>
          </div>
        )
      )}
      <iframe
        ref={frame}
        title={block.description}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={snapshotDocument("", block.css, theme)}
        className="block h-full w-full border-0"
        style={{
          colorScheme: theme,
          visibility: state.status === "ready" ? undefined : "hidden",
        }}
      />
    </>
  );
}
