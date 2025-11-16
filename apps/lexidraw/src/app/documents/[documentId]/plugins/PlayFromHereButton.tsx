"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  useEffectEvent,
} from "react";
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
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { AudioPlayer } from "~/components/ui/audio-player";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { useMarkdownTools } from "../utils/markdown";
import { toast } from "sonner";
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

type TtsSegment = {
  index: number;
  audioUrl: string;
  text: string;
  sectionTitle?: string;
  sectionId?: string;
  sectionIndex?: number;
};

export function PlayFromHereButton({
  documentId,
  buttonClassName,
}: {
  documentId: string;
  buttonClassName?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<TtsSegment[]>([]);
  const [initialIndex, setInitialIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const hasTriggeredTts = useRef(false);
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const { convertEditorStateToMarkdown } = useMarkdownTools();
  const startTts = api.tts.startDocumentTts.useMutation();
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
  const manifestQuery = api.tts.getDocumentTtsManifest.useQuery(
    { documentId },
    { enabled: open && statusQuery.data?.status === "ready" },
  );

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

  const handleOpenChange = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      // Reset segments and tracking when closing
      setSegments([]);
      setInitialIndex(0);
      hasTriggeredTts.current = false;
      setPosition({ x: 0, y: 0 }); // Reset position when closing
    } else {
      // Reset tracking when opening
      hasTriggeredTts.current = false;
    }
  }, []);

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

  // Stable callback for TTS generation that can access latest values
  const generateTts = useEffectEvent(async () => {
    if (hasTriggeredTts.current) return;
    hasTriggeredTts.current = true;
    try {
      setLoading(true);
      const md = convertEditorStateToMarkdown(editor.getEditorState());
      await startTts.mutateAsync({ documentId, markdown: md });
    } catch (e) {
      console.warn("[play-from-here] error", e);
      toast.error("Failed to load audio.");
      hasTriggeredTts.current = false; // Allow retry on error
    } finally {
      setLoading(false);
    }
  });

  // Trigger TTS generation when popover opens
  useEffect(() => {
    if (!open) return;
    generateTts();
  }, [open, generateTts]);

  const disabled = useMemo(() => false, []);

  // When job is ready, populate segments and seek to nearest heading
  useEffect(() => {
    if (!open) return;
    if (statusQuery.data?.status !== "ready") return;
    if (!manifestQuery.data) return;
    if (segments.length > 0) return;
    const segs = (manifestQuery.data.segments ?? []) as TtsSegment[];
    if (segs.length === 0) return;
    const { sectionId } = findNearestHeadingSlug(editor);
    setSegments(segs);
    if (sectionId) {
      const idx = segs.findIndex((s) => s.sectionId === sectionId);
      setInitialIndex(idx >= 0 ? idx : 0);
    } else {
      setInitialIndex(0);
    }
  }, [
    open,
    statusQuery.data?.status,
    manifestQuery.data,
    segments.length,
    editor,
    findNearestHeadingSlug,
  ]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          disabled={disabled}
          className={buttonClassName}
          title={disabled ? "Generate audio first" : "Play from here"}
        >
          ▶
        </Button>
      </PopoverTrigger>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <DraggablePopoverContent
          position={position}
          loading={loading}
          segments={segments}
          initialIndex={initialIndex}
        />
      </DndContext>
    </Popover>
  );
}

function DraggablePopoverContent({
  position,
  loading,
  segments,
  initialIndex,
}: {
  position: { x: number; y: number };
  loading: boolean;
  segments: TtsSegment[];
  initialIndex: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: "tts-popover",
    });

  // Local playback index, initialized from initialIndex
  const [currentIndex, setCurrentIndex] = useState(0);
  useEffect(() => {
    if (typeof initialIndex === "number" && initialIndex >= 0) {
      setCurrentIndex(Math.min(initialIndex, Math.max(0, segments.length - 1)));
    }
  }, [initialIndex, segments.length]);
  const current = useMemo(
    () => segments[currentIndex],
    [segments, currentIndex],
  );

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
        className="w-full min-w-[320px] max-w-2xl px-4 pt-0 max-h-[40vh] overflow-y-auto overflow-x-hidden gap-4"
        side="bottom"
        align="end"
        sideOffset={8}
        onEscapeKeyDown={(e) => {
          // Prevent closing on Escape key
          e.preventDefault();
        }}
        onInteractOutside={(e) => {
          // Prevent closing on outside click
          e.preventDefault();
        }}
      >
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
              Play from here
            </h3>
            <PopoverClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-0 right-0 p-1 z-30"
              >
                <X className="h-4 w-4" />
              </Button>
            </PopoverClose>
          </div>
          {loading && (
            <div className="text-sm text-muted-foreground">Loading audio…</div>
          )}
          {!loading && segments.length > 0 && (
            <div className="space-y-2">
              {current?.sectionTitle && (
                <div className="text-sm text-muted-foreground font-medium">
                  {current.sectionTitle}
                </div>
              )}
              <AudioPlayer
                src={current?.audioUrl ?? ""}
                autoPlay
                onEnded={() => {
                  if (currentIndex < segments.length - 1) {
                    setCurrentIndex(currentIndex + 1);
                  }
                }}
                className="min-w-xs"
              />
            </div>
          )}
        </div>

        {/* Scrollable segments list */}
        {!loading && segments.length > 0 && (
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
        )}
        {!loading && segments.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No audio segments found. Generate audio first.
          </div>
        )}
      </PopoverContent>
    </div>
  );
}
