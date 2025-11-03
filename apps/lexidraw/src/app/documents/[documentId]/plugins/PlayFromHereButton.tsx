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
import ArticleAudioPlayer from "~/components/audio/ArticleAudioPlayer";
import { useMarkdownTools } from "../utils/markdown";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { PopoverClose } from "@radix-ui/react-popover";
import { X } from "lucide-react";
import {
  DndContext,
  useDraggable,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  type DragEndEvent,
} from "@dnd-kit/core";

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

  const finalTransform = transform
    ? {
        x: position.x + transform.x,
        y: position.y + transform.y,
      }
    : position;

  return (
    <PopoverContent
      ref={setNodeRef}
      className="w-full min-w-[320px] max-w-2xl p-4"
      side="bottom"
      align="end"
      sideOffset={8}
      style={{
        transform: `translate(${finalTransform.x}px, ${finalTransform.y}px)`,
      }}
      onEscapeKeyDown={(e) => {
        // Prevent closing on Escape key
        e.preventDefault();
      }}
      onInteractOutside={(e) => {
        // Prevent closing on outside click
        e.preventDefault();
      }}
    >
      <PopoverClose asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-0 right-0 p-1 z-10"
        >
          <X className="h-4 w-4" />
        </Button>
      </PopoverClose>
      <h3
        {...attributes}
        {...listeners}
        className={`text-lg font-semibold leading-none tracking-tight mb-4 select-none pr-8 ${
          isDragging ? "cursor-grabbing" : "cursor-move"
        }`}
      >
        Play from here
      </h3>
      <div>
        {loading && (
          <div className="text-sm text-muted-foreground">Loading audio…</div>
        )}
        {!loading && segments.length > 0 && (
          <ArticleAudioPlayer segments={segments} initialIndex={initialIndex} />
        )}
        {!loading && segments.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No audio segments found. Generate audio first.
          </div>
        )}
      </div>
    </PopoverContent>
  );
}
