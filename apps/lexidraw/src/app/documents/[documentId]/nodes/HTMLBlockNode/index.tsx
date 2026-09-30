"use client";
import {
  HTMLBlockNode as HeadlessHTMLBlockNode,
  SavedHTMLBlockSchema,
  snapshotDocument,
  type SavedHTMLBlock,
} from "@packages/lexical-nodes";
import { useEffect, useRef, useState } from "react";
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
function SavedBlock({ block }: { block: SavedHTMLBlock }) {
  const params = useParams<{ documentId?: string; id?: string }>();
  const documentId = params.documentId ?? params.id ?? "";
  const supplied = useHTMLBlockPreviews();
  const preview = api.htmlBlocks.preview.useQuery(
    { id: documentId, blockId: block.id, revision: block.revision, width: 800 },
    {
      enabled: supplied === null && Boolean(documentId),
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
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
  return (
    <section
      id={`html-block-${block.id}`}
      aria-label={block.description}
      className="my-4 w-full overflow-hidden rounded-lg border border-border bg-background"
      contentEditable={false}
    >
      {run.phase === "running" && !invalidated && supplied === null ? (
        <RunningBlock key={run.attempt} block={block} />
      ) : matching?.status === "ready" && matching.data ? (
        <img
          src={`data:image/png;base64,${matching.data}`}
          alt={`${block.description} — saved starting state`}
          width={matching.width}
          height={matching.height}
          className="block h-auto w-full"
        />
      ) : (
        <div role="status" className="p-4">
          {preview.isLoading
            ? "Preparing saved-state preview…"
            : matching?.status === "failed"
              ? matching.message
              : "Saved-state preview unavailable. You can still run the block."}
        </div>
      )}
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
function RunningBlock({ block }: { block: SavedHTMLBlock }) {
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
    <div>
      {state.status !== "ready" && (
        <p role="status" className="p-3">
          {state.status === "failed"
            ? state.message
            : "Loading interactive block…"}
        </p>
      )}
      <iframe
        ref={frame}
        title={block.description}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={snapshotDocument("", block.css)}
        className="block w-full border-0"
        style={{
          height: block.height,
          display: state.status === "failed" ? "none" : undefined,
        }}
      />
    </div>
  );
}
