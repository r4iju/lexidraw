"use client";
import { DeviceNarrationPanel } from "~/lib/narration/device-panel";
import { ProNarrationPanel } from "~/lib/narration/panel";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { type HeadingNode, $isHeadingNode } from "@lexical/rich-text";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "~/components/ui/popover";
import { AudioPlayer } from "~/components/ui/audio-player";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { api } from "~/trpc/react";
import { PopoverClose } from "@radix-ui/react-popover";
import { X, Play } from "lucide-react";
import {
  DndContext,
  useDraggable,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  type DragEndEvent,
} from "@dnd-kit/core";
import { cn } from "~/lib/utils";

import {
  ListenSegments,
  type ListenSegment as TtsSegment,
} from "~/lib/narration/listen-contracts";
import { SavedRecordingProjection } from "~/lib/narration/saved-recording";
import {
  SavedRecordingPlayback,
  type SavedAudioScreen,
} from "./SavedRecordingPlayback";
type AudioScreen =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "playable"; segments: TtsSegment[]; stale: boolean };

/**
 * The document's one read-aloud player. It is held by `ListenProvider`, above
 * the controls that open it, so what it is playing outlives them: switching
 * between editing and reading swaps the toolbar for the reading pill without
 * stopping the audio or asking for it again. It opens beside `anchor`, the
 * control showing now, or at the foot of the screen when none is in sight.
 */
export function ListenPlayer(props: {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: HTMLElement | null;
}) {
  // Keep the popover's route/focus lifetime stable while playback resets on close.
  const shown =
    props.anchor && !props.anchor.closest("[inert]") ? props.anchor : null;
  const anchored = useMemo(() => shown && { current: shown }, [shown]);
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      {anchored ? (
        <PopoverAnchor virtualRef={anchored} />
      ) : (
        <PopoverAnchor className="fixed bottom-0 right-4" />
      )}
      <ListenPlayerSession
        key={`${props.documentId}:${props.open}`}
        documentId={props.documentId}
        open={props.open}
      />
    </Popover>
  );
}

function ListenPlayerSession({
  documentId,
  open,
}: Pick<React.ComponentProps<typeof ListenPlayer>, "documentId" | "open">) {
  const [editor] = useLexicalComposerContext();
  // Drag position is a user event, owned by this open document session.
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const statusQuery = api.tts.getDocumentTtsStatus.useQuery(
    { documentId },
    {
      enabled: open,
      refetchOnWindowFocus: (query) => {
        const status = query.state.data?.status;
        // Only refetch on focus when job is actively processing
        return status === "queued" || status === "processing";
      },
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        // Only poll when job is actively processing
        if (status === "queued" || status === "processing") {
          return 1500; // Poll every 1.5 seconds
        }
        // Stop polling for terminal states or when no job exists
        return false;
      },
    },
  );
  const status = statusQuery.data?.status;
  // Parts still being made come after the ones listed so far.
  const making = status === "queued" || status === "processing";
  // Asked again while parts are made, and once made, until all are listed:
  // a read just after the store writes can miss.
  const made = statusQuery.data?.segmentCount ?? 0;
  const manifestQuery = api.tts.getDocumentTtsManifest.useQuery(
    { documentId },
    {
      enabled: open,
      refetchInterval: (query) =>
        making ||
        (status === "ready" && (query.state.data?.segments.length ?? 0) < made)
          ? 1500
          : false,
    },
  );
  const refetchManifest = manifestQuery.refetch;
  // The generated manifest query follows the external job store to its final parts.
  useEffect(() => {
    if (open && status === "ready") void refetchManifest();
  }, [open, status, refetchManifest]);

  const slugifySection = useCallback(
    (title: string | undefined, index: number): string => {
      const base = (title || "untitled").toLowerCase().trim();
      const slug = base
        .normalize("NFKD")
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      return `${slug || "section"}-${index}`;
    },
    [],
  );

  const findNearestHeadingSlug = useCallback(
    (
      editor: LexicalEditor,
    ): {
      sectionId?: string;
    } => {
      const result: { sectionId?: string } = {};
      editor.getEditorState().read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        let node: LexicalNode | null = sel.anchor.getNode();
        if (!node) return;
        if (!$isElementNode(node)) node = node.getParent() as LexicalNode;
        let depth = 0;
        while (node && depth < 100) {
          if ($isHeadingNode(node)) {
            const title = (node as HeadingNode).getTextContent();
            result.sectionId = slugifySection(title, 0);
            return;
          }
          const prev = node.getPreviousSibling?.();
          if (prev) {
            let cursor: LexicalNode | null = prev;
            while (cursor) {
              if ($isHeadingNode(cursor)) {
                const title = (cursor as HeadingNode).getTextContent();
                result.sectionId = slugifySection(title, 0);
                return;
              }
              cursor = cursor.getPreviousSibling?.() as LexicalNode | null;
            }
          }
          node = node.getParent?.() ?? null;
          depth++;
        }
      });
      return result;
    },
    [slugifySection],
  );

  // Drag handlers using @dnd-kit
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { delta } = event;
    if (delta && (delta.x || delta.y)) {
      setPosition((prev) => ({
        x: prev.x + delta.x,
        y: prev.y + delta.y,
      }));
    }
  }, []);

  const denied = [statusQuery.error, manifestQuery.error].some(
    (error) =>
      error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED",
  );
  const parsed = ListenSegments.safeParse(manifestQuery.data?.segments ?? []);
  const saved = SavedRecordingProjection.safeParse(
    manifestQuery.data?.savedRecording,
  );
  const savedScreen: SavedAudioScreen =
    denied || manifestQuery.error
      ? { kind: "read-error" }
      : manifestQuery.isPending || !manifestQuery.data
        ? { kind: "loading" }
        : saved.success
          ? saved.data
          : { kind: "stop", reason: "corrupt-payload" };
  const invalidManifest = !parsed.success;
  const segments = denied || !parsed.success ? [] : parsed.data;
  const stale = !!statusQuery.error || !!manifestQuery.error || invalidManifest;
  const screen: AudioScreen = segments.length
    ? { kind: "playable", segments, stale }
    : stale || denied
      ? { kind: "error" }
      : statusQuery.isPending ||
          ((making || status === "ready") &&
            (manifestQuery.isPending || !manifestQuery.data))
        ? { kind: "loading" }
        : { kind: "empty" };
  // The first immutable audio URL identifies a recording. Appends keep that identity.
  // The caret is read only when that recording first becomes playable.
  const initialIndex = () => {
    const { sectionId } =
      status === "ready" ? findNearestHeadingSlug(editor) : {};
    const index = sectionId
      ? segments.findIndex((segment) => segment.sectionId === sectionId)
      : -1;
    return Math.max(0, index);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <DraggablePopoverContent
        position={position}
        documentId={documentId}
        screen={screen}
        savedScreen={savedScreen}
        initialIndex={initialIndex}
        denied={denied}
        invalidManifest={invalidManifest}
        statusError={!!statusQuery.error}
        manifestError={!!manifestQuery.error}
        retryStatus={() => void statusQuery.refetch()}
        retryManifest={() => void manifestQuery.refetch()}
        making={making}
      />
    </DndContext>
  );
}

/**
 * The control that opened the player from `focused`, what had the focus as
 * it opened: a menu's item goes with its menu, and a submenu with the menu it
 * is in, so it is the button of the menu that was opened first.
 */
function openerOf(focused: Element | null): HTMLElement | null {
  let opener = focused;
  for (
    let menu = opener?.closest("[role=menu]");
    menu;
    menu = opener?.closest("[role=menu]")
  ) {
    opener = document.getElementById(
      menu.getAttribute("aria-labelledby") ?? "",
    );
  }
  return opener instanceof HTMLElement ? opener : null;
}

/** Whether a key pressed at `target` is being typed into the page. */
function typingOutside(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    !target.closest("[data-listen-player]") &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}

function DraggablePopoverContent({
  documentId,
  position,
  screen,
  initialIndex,
  savedScreen,
  denied,
  invalidManifest,
  statusError,
  manifestError,
  retryStatus,
  retryManifest,
  making,
}: {
  documentId: string;
  position: { x: number; y: number };
  screen: AudioScreen;
  savedScreen: SavedAudioScreen;
  initialIndex: () => number;
  denied: boolean;
  invalidManifest: boolean;
  statusError: boolean;
  manifestError: boolean;
  retryStatus: () => void;
  retryManifest: () => void;
  /** Whether more parts are being made, to follow the ones listed. */
  making: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: "tts-popover",
    });
  // What opened the player, which has the focus back when it closes.
  const opener = useRef<HTMLElement | null>(null);

  const finalTransform = transform
    ? {
        x: position.x + transform.x,
        y: position.y + transform.y,
      }
    : position;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: `translate(${finalTransform.x}px, ${finalTransform.y}px)`,
      }}
    >
      <PopoverContent
        // The page stays usable while it plays, so a sheet has no scrim.
        className="w-full min-w-[320px] max-w-2xl px-4 pt-0 max-h-[40vh] overflow-y-auto overflow-x-hidden gap-4 max-sm:min-w-0 max-sm:shadow-(--elevation-modal)"
        side="bottom"
        align="end"
        sideOffset={8}
        data-listen-player
        onOpenAutoFocus={() => {
          opener.current = openerOf(document.activeElement);
        }}
        onEscapeKeyDown={(e) => {
          // Escape while writing is the editor's, and the audio plays on.
          if (typingOutside(e.target)) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const back = opener.current;
          opener.current = null;
          if (back?.isConnected && !back.closest("[inert]")) back.focus();
        }}
        onInteractOutside={(e) => {
          // Prevent closing on outside click
          e.preventDefault();
        }}
      >
        <DeviceNarrationPanel documentId={documentId} />
        <ProNarrationPanel documentId={documentId} />
        {/* Sticky header + controls */}
        <div className="sticky top-0 z-20 bg-popover -mx-4 -mt-4 px-4 pt-4 pb-2">
          <div className="relative min-w-xs">
            <h3
              {...attributes}
              {...listeners}
              className={`text-lg font-semibold leading-none tracking-tight mb-3 select-none ${
                isDragging ? "cursor-grabbing" : "cursor-move"
              }`}
            >
              Listen
            </h3>
            <PopoverClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 p-1 z-30"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close player</span>
              </Button>
            </PopoverClose>
          </div>
          {screen.kind === "loading" && <p role="status">Loading audio…</p>}
          {invalidManifest && (
            <p role="alert">
              Audio segments could not be read safely.{" "}
              <Button onClick={retryManifest}>Retry audio segments</Button>
            </p>
          )}
          {denied && (
            <p role="alert">
              Audio access could not be confirmed. Cached media is hidden.
            </p>
          )}
          {statusError && (
            <p role="alert">
              Audio status could not be refreshed.{" "}
              <Button onClick={retryStatus}>Retry audio status</Button>
            </p>
          )}
          {manifestError && (
            <p role="alert">
              Audio segments could not be refreshed.{" "}
              <Button onClick={retryManifest}>Retry audio segments</Button>
            </p>
          )}
          {screen.kind === "playable" && screen.stale && (
            <p role="status">
              Cached audio may be stale. Refresh before relying on its progress.
            </p>
          )}
        </div>
        <SavedRecordingPlayback documentId={documentId} screen={savedScreen} />
        {screen.kind === "playable" && (
          <RecordingPlayback
            key={screen.segments[0]?.audioUrl ?? "recording"}
            segments={screen.segments}
            initialIndex={initialIndex}
            making={making}
          />
        )}
        {screen.kind === "empty" && savedScreen.kind === "none" && (
          <p>
            No saved audio is available. The source controls above show whether
            new narration is available.
          </p>
        )}
      </PopoverContent>
    </div>
  );
}

function RecordingPlayback({
  segments,
  initialIndex,
  making,
}: {
  segments: TtsSegment[];
  initialIndex: () => number;
  making: boolean;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const current =
    segments[currentIndex] ?? (making ? undefined : segments.at(-1));
  const waiting = !current;
  return (
    <>
      <div className="space-y-2">
        {current?.sectionTitle && (
          <div className="text-sm text-muted-foreground font-medium">
            {current.sectionTitle}
          </div>
        )}
        <AudioPlayer
          // Waiting, it keeps the part that ended, and plays the next
          // as it arrives.
          src={(current ?? segments.at(-1))?.audioUrl ?? ""}
          autoPlay
          onEnded={() => {
            if (currentIndex < segments.length - 1 || making) {
              setCurrentIndex(currentIndex + 1);
            }
          }}
          className="min-w-xs"
        />
        {waiting && making && (
          <div className="text-sm text-muted-foreground">
            Making the next part…
          </div>
        )}
      </div>

      {/* Scrollable segments list */}
      <Accordion
        type="single"
        collapsible
        className="border border-border rounded-md w-full max-w-xs min-w-xs mt-4"
      >
        <AccordionItem value="segments">
          <AccordionTrigger className="px-4">Segments</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-0 divide-y divide-border pb-0">
            {segments.map((s, i) => {
              const isCurrent = i === currentIndex;
              const isLast = i === segments.length - 1;
              const segmentName = (() => {
                if (s.sectionTitle) {
                  let chunkCount = 0;
                  for (let j = 0; j <= i; j++) {
                    if (
                      segments[j]?.sectionTitle === s.sectionTitle &&
                      (s.sectionIndex === undefined ||
                        segments[j]?.sectionIndex === s.sectionIndex)
                    ) {
                      chunkCount++;
                    }
                  }
                  return chunkCount === 1
                    ? s.sectionTitle
                    : `${s.sectionTitle} (${chunkCount})`;
                }
                return `Block ${i + 1}`;
              })();
              return (
                <Button
                  key={s.index}
                  variant={isCurrent ? "default" : "secondary"}
                  onClick={() => setCurrentIndex(i)}
                  className={cn(
                    "w-full flex flex-row items-center justify-start gap-2 rounded-none",
                    {
                      "rounded-b-md": isLast,
                    },
                  )}
                >
                  <Play
                    className={`size-4 mr-2 ${
                      isCurrent ? "text-primary-foreground" : "text-primary"
                    }`}
                  />
                  <span className="font-mono">{i + 1}.</span>
                  <span className="truncate">{segmentName}</span>
                </Button>
              );
            })}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  );
}
