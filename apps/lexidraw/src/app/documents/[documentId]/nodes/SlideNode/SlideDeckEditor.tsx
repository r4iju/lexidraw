import type { JSX, SetStateAction, Dispatch } from "react";
import React, {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
} from "react";
import {
  SlideDeckData,
  SlideData,
  SlideElementSpec,
  DEFAULT_BOX_EDITOR_STATE,
  EditorStateJSON,
} from "./SlideNode";
import { theme as editorTheme } from "../../themes/theme";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusCircleIcon,
  Trash2Icon,
  PlusSquareIcon,
  EllipsisVerticalIcon,
  PaintBucketIcon,
} from "lucide-react";
import {
  type EditorState,
  createEditor,
  ParagraphNode,
  TextNode,
  LineBreakNode,
  LexicalEditor,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { LayoutContainerNode } from "../LayoutContainerNode";
import { LayoutItemNode } from "../LayoutItemNode";
import { KeywordNode } from "../KeywordNode";
import { HashtagNode } from "@lexical/hashtag";
import { EmojiNode } from "../EmojiNode";
import { ImageNode } from "../ImageNode/ImageNode";
import { InlineImageNode } from "../InlineImageNode/InlineImageNode";
import { VideoNode } from "../VideoNode/VideoNode";
import { PollNode } from "../PollNode";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import MarkdownShortcutPlugin from "../../plugins/MarkdownShortcutPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import TwitterPlugin from "../../plugins/TwitterPlugin";
import YouTubePlugin from "../../plugins/YouTubePlugin";
import { TweetNode } from "../TweetNode";
import { YouTubeNode } from "../YouTubeNode";
import ExcalidrawPlugin from "../../plugins/ExcalidrawPlugin";
import { ExcalidrawNode } from "../ExcalidrawNode";
import { FigmaNode } from "../FigmaNode";
import { EquationNode } from "../EquationNode";
import FigmaPlugin from "../../plugins/FigmaPlugin";
import EquationsPlugin from "../../plugins/EquationsPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import EmojisPlugin from "../../plugins/EmojisPlugin";
import KeywordsPlugin from "../../plugins/KeywordsPlugin";
import LinkPlugin from "../../plugins/LinkPlugin";
import MentionsPlugin from "../../plugins/MentionsPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import InlineImagePlugin from "../../plugins/InlineImagePlugin";
import ImagePlugin from "../../plugins/ImagePlugin";
import VideoPlugin from "../../plugins/VideoPlugin";
import { LayoutPlugin } from "../../plugins/LayoutPlugin/LayoutPlugin";
import CollapsiblePlugin from "../../plugins/CollapsiblePlugin";
import { CollapsibleContainerNode } from "../../plugins/CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleContentNode } from "../../plugins/CollapsiblePlugin/CollapsibleContentNode";
import { CollapsibleTitleNode } from "../../plugins/CollapsiblePlugin/CollapsibleTitleNode";
import PollPlugin from "../../plugins/PollPlugin";
import TableCellResizer from "../../plugins/TableCellResizer";
import TableActionMenuPlugin from "../../plugins/TableActionMenuPlugin";
import { Button } from "~/components/ui/button";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  DragEndEvent,
} from "@dnd-kit/core";
import { cn } from "~/lib/utils";
import ToolbarPlugin from "../../plugins/ToolbarPlugin";
import FloatingLinkEditorPlugin from "../../plugins/FloatingLinkEditorPlugin";
import CodeActionMenuPlugin from "../../plugins/CodeActionMenuPlugin";
import FloatingTextFormatToolbarPlugin from "../../plugins/FloatingTextFormatToolbarPlugin";
import { DisableChecklistSpacebarPlugin } from "../../plugins/list-spacebar-plugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import EmojiPickerPlugin from "../../plugins/EmojiPickerPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { ColorPickerContent } from "~/components/ui/color-picker";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
} from "~/components/ui/dialog";
import { MarkNode } from "@lexical/mark";
import { AutocompleteNode } from "../AutocompleteNode";
import { ThreadNode } from "../ThreadNode";
import { CommentNode } from "../CommentNode";
import { MermaidNode } from "../MermaidNode";
import { PageBreakNode } from "../PageBreakNode";
import { StickyNode } from "../StickyNode";
import PageBreakPlugin from "../../plugins/PageBreakPlugin";
import MermaidPlugin from "../../plugins/MermaidPlugin";
import AutocompletePlugin from "../../plugins/AutocompletePlugin";
import { SessionUUIDProvider } from "../../plugins/AutocompletePlugin/session-uuid-provider";

export const NESTED_EDITOR_NODES = [
  // SlideNode,
  MarkNode,
  AutocompleteNode,
  CommentNode,
  ThreadNode,
  PageBreakNode,
  StickyNode,
  MermaidNode,
  HeadingNode,
  QuoteNode,
  ListItemNode,
  ListNode,
  LinkNode,
  ParagraphNode,
  TextNode,
  LineBreakNode,
  KeywordNode,
  HashtagNode,
  EmojiNode,
  ImageNode,
  InlineImageNode,
  VideoNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  AutoLinkNode,
  HorizontalRuleNode,
  EquationNode,
  TweetNode,
  YouTubeNode,
  ExcalidrawNode,
  FigmaNode,
  CodeNode,
  CodeHighlightNode,
  LayoutContainerNode,
  LayoutItemNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  PollNode,
];

interface SlideDeckEditorProps {
  initialDataString: string;
  onDeckDataChange: (data: SlideDeckData) => void;
  parentEditor: LexicalEditor;
}

interface CornerHandleProps {
  corner: "nw" | "ne" | "sw" | "se";
  element: SlideElementSpec;
  onResize: (
    elementId: string,
    corner: "nw" | "ne" | "sw" | "se",
    dx: number,
    dy: number,
    initialElement: SlideElementSpec,
  ) => void;
}

const CornerHandle: React.FC<CornerHandleProps> = ({
  corner,
  element,
  onResize,
}) => {
  const posStyles: Record<typeof corner, string> = {
    nw: "left-0 top-0 cursor-nwse-resize",
    ne: "right-0 top-0 cursor-nesw-resize",
    sw: "left-0 bottom-0 cursor-nesw-resize",
    se: "right-0 bottom-0 cursor-nwse-resize",
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // Prevent drag if clicking on handle
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialElement = { ...element }; // Capture initial state

    const move = (ev: PointerEvent) => {
      ev.stopPropagation();
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      onResize(element.id, corner, dx, dy, initialElement);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "absolute w-3 h-3 bg-primary/50 border border-primary rounded-full -m-1.5 z-30 hover:bg-primary",
        posStyles[corner],
      )}
    />
  );
};

interface DraggableBoxWrapperProps {
  element: SlideElementSpec;
  nestedEditor: LexicalEditor;
  onBoxContentChange: (elementId: string, newEditorState: EditorState) => void;
  historyState: ReturnType<typeof useSharedHistoryContext>["historyState"];
  isSelected: boolean;
  onSelect: (elementId: string | null) => void;
  onElementUpdate: (
    elementId: string,
    updates: Partial<SlideElementSpec>,
  ) => void;
  onElementDelete: (elementId: string) => void;
  setShowColorPicker: Dispatch<SetStateAction<boolean>>;
  isLinkEditMode: boolean;
  setIsLinkEditMode: Dispatch<SetStateAction<boolean>>;
  deselectElement: () => void;
}

const DraggableBoxWrapper: React.FC<DraggableBoxWrapperProps> = ({
  element,
  nestedEditor,
  onBoxContentChange,
  historyState,
  isSelected,
  onSelect,
  onElementUpdate,
  onElementDelete,
  setShowColorPicker,
  isLinkEditMode,
  setIsLinkEditMode,
  deselectElement,
}) => {
  const { attributes, listeners, setNodeRef, transform, active } = useDraggable(
    {
      id: element.id,
      disabled: isLinkEditMode,
    },
  );
  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement>();

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

  const isDragging = active?.id === element.id;

  const style: React.CSSProperties = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    border: "1px solid #ccc",
    overflow: "hidden",
    backgroundColor: element.backgroundColor || "white",
    boxSizing: "border-box",
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isSelected || isDragging ? 20 : 10,
    cursor: isDragging ? "grabbing" : isSelected ? "move" : "grab",
  } as const satisfies React.CSSProperties;

  const handleBoxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isSelected) {
      onSelect(element.id);
    }
  };

  const handleResize = (
    elementId: string,
    corner: "nw" | "ne" | "sw" | "se",
    dx: number,
    dy: number,
    initialElement: SlideElementSpec,
  ) => {
    let { x: newX, y: newY, width: newW, height: newH } = initialElement;
    const minW = 40,
      minH = 20; // Minimum dimensions

    if (corner.includes("w")) {
      newW = Math.max(minW, initialElement.width - dx);
      newX = initialElement.x + (initialElement.width - newW);
    } else if (corner.includes("e")) {
      newW = Math.max(minW, initialElement.width + dx);
    }
    if (corner.includes("n")) {
      newH = Math.max(minH, initialElement.height - dy);
      newY = initialElement.y + (initialElement.height - newH);
    } else if (corner.includes("s")) {
      newH = Math.max(minH, initialElement.height + dy);
    }
    onElementUpdate(elementId, { x: newX, y: newY, width: newW, height: newH });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn("group slide-element-box", "p-1")}
      onClick={handleBoxClick}
    >
      <div data-uid={element.id} className="relative size-full">
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div className="absolute top-0 right-0 p-1 cursor-pointer z-10">
                <EllipsisVerticalIcon className="h-4 w-4" />
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  onElementDelete(element.id);
                  deselectElement();
                }}
              >
                <Trash2Icon className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  deselectElement();
                  setShowColorPicker(true);
                }}
              >
                <PaintBucketIcon className="h-4 w-4 mr-2" />
                Background Color
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <LexicalNestedComposer
            key={element.id}
            initialEditor={nestedEditor}
            initialNodes={NESTED_EDITOR_NODES}
            initialTheme={editorTheme}
            skipCollabChecks={true}
          >
            <DisableChecklistSpacebarPlugin />
            <TabIndentationPlugin />
            <EmojiPickerPlugin />
            <RichTextPlugin
              contentEditable={
                <div ref={onRef}>
                  <ContentEditable className="p-2 h-full w-full outline-none caret-foreground" />
                </div>
              }
              placeholder={
                <div className="absolute top-2 left-2 text-muted-foreground pointer-events-none">
                  Type...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <OnChangePlugin
              onChange={(editorState) =>
                onBoxContentChange(element.id, editorState)
              }
              ignoreHistoryMergeTagChange
              ignoreSelectionChange
            />
            <SessionUUIDProvider>
              <AutocompletePlugin />
            </SessionUUIDProvider>
            <PageBreakPlugin />
            <MermaidPlugin />
            <HistoryPlugin externalHistoryState={historyState} />
            <MarkdownShortcutPlugin />
            <HorizontalRulePlugin />
            <EquationsPlugin />
            <AutoFocusPlugin />
            <TablePlugin hasCellMerge hasCellBackgroundColor />
            <MentionsPlugin />
            <LinkPlugin />
            <EmojisPlugin />
            <HashtagPlugin />
            <KeywordsPlugin />
            <TwitterPlugin />
            <YouTubePlugin />
            <ExcalidrawPlugin />
            <FigmaPlugin />
            <ImagePlugin />
            <InlineImagePlugin />
            <VideoPlugin />
            <LayoutPlugin />
            <CollapsiblePlugin />
            <PollPlugin />
            <TableCellResizer />
            {floatingAnchorElem && (
              <>
                <TableActionMenuPlugin
                  anchorElem={floatingAnchorElem}
                  cellMerge={true}
                />
                <CodeActionMenuPlugin anchorElem={floatingAnchorElem} />
                <FloatingLinkEditorPlugin
                  anchorElem={floatingAnchorElem}
                  isLinkEditMode={isLinkEditMode}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
                <TableActionMenuPlugin
                  anchorElem={floatingAnchorElem}
                  cellMerge={true}
                />
                <FloatingTextFormatToolbarPlugin
                  anchorElem={floatingAnchorElem}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
              </>
            )}
          </LexicalNestedComposer>
        </>
      </div>
      <div
        className={cn(
          "absolute inset-0 rounded pointer-events-none transition-all duration-100",
          isSelected
            ? "ring-2 ring-primary/90 opacity-100"
            : "opacity-0 group-hover:opacity-100 group-hover:ring-2 group-hover:ring-primary/40",
        )}
      />
      {isSelected &&
        (["nw", "ne", "sw", "se"] as const).map((corner) => (
          <CornerHandle
            key={corner}
            corner={corner}
            element={element}
            onResize={handleResize}
          />
        ))}
    </div>
  );
};

export default function SlideDeckEditorComponent({
  initialDataString,
  onDeckDataChange,
  parentEditor,
}: SlideDeckEditorProps): JSX.Element {
  const [deckData, setDeckData] = useState<SlideDeckData>(() => {
    const parsed = JSON.parse(initialDataString) as SlideDeckData;
    parsed.slides = parsed.slides.map((s) => ({
      ...s,
      elements: (s.elements || []).map((el) => ({
        ...el,
        backgroundColor: el.backgroundColor || "transparent",
      })),
    }));
    return parsed;
  });
  const [isLinkEditMode, setIsLinkEditMode] = useState(false);
  const elementEditorsRef = useRef<Map<string, LexicalEditor>>(new Map());
  const [activeElementEditors, setActiveElementEditors] = useState<
    Map<string, LexicalEditor>
  >(new Map());
  const { historyState } = useSharedHistoryContext();
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSlideBgColorPicker, setShowSlideBgColorPicker] = useState(false);
  const [editingElementIdForColor, setEditingElementIdForColor] = useState<
    string | null
  >(null);

  const currentSlideIndex = useMemo(() => {
    if (!deckData.slides || deckData.slides.length === 0) return -1;
    const idx = deckData.slides.findIndex(
      (s) => s.id === deckData.currentSlideId,
    );
    return idx === -1 ? 0 : idx;
  }, [deckData.slides, deckData.currentSlideId]);

  const currentSlide = useMemo(() => {
    if (currentSlideIndex === -1 || !deckData.slides[currentSlideIndex]) {
      return undefined;
    }
    return deckData.slides[currentSlideIndex];
  }, [deckData.slides, currentSlideIndex]);

  useEffect(() => {
    if (currentSlide?.elements) {
      const currentEditorsMapInRef = elementEditorsRef.current;
      const newEditorIds = new Set(currentSlide.elements.map((el) => el.id));
      let editorsChanged = false;

      currentSlide.elements.forEach((element) => {
        let nestedEditor = currentEditorsMapInRef.get(element.id);
        let isNewEditor = false;

        if (!nestedEditor) {
          nestedEditor = createEditor({
            parentEditor: parentEditor,
            nodes: NESTED_EDITOR_NODES,
            theme: editorTheme,
            onError: (error) =>
              console.error(
                `Error in nested editor for element ${element.id}:`,
                error,
              ),
          });
          currentEditorsMapInRef.set(element.id, nestedEditor);
          editorsChanged = true;
          isNewEditor = true; // Mark as new editor
        }

        const stateToSetInEditor: EditorStateJSON | null =
          element.editorStateJSON;
        const forceSetState = isNewEditor; // Always set state for new editors

        // Log before attempting to parse/set state
        console.log(
          `[SlideDeckEditor useEffect] Processing element ${element.id}:`,
          `isNewEditor: ${isNewEditor}, forceSetState: ${forceSetState}, ` +
            `has editorStateJSON: ${!!stateToSetInEditor}, ` +
            `editorStateJSON to be used:`,
          JSON.stringify(stateToSetInEditor, null, 2),
        );

        // Set editor state if forced (new editor or markdown processed) or if JSON differs
        if (stateToSetInEditor) {
          // Ensure there's a state to set
          const currentNestedEditorStateJSONString = JSON.stringify(
            nestedEditor.getEditorState().toJSON(),
          );
          const stateToSetInEditorString = JSON.stringify(stateToSetInEditor);

          if (
            forceSetState ||
            currentNestedEditorStateJSONString !== stateToSetInEditorString // Compare stringified versions
          ) {
            try {
              console.log(
                `[SlideDeckEditor useEffect] Attempting to parse and set state for ${element.id}.`,
              );
              const newLexicalState = nestedEditor.parseEditorState(
                stateToSetInEditorString, // Use the already stringified version
              );
              nestedEditor.setEditorState(newLexicalState);
            } catch (e) {
              console.error(
                `Failed to parse state for element ${element.id} in useEffect (stateToSet: ${stateToSetInEditor}):`,
                e,
              );
              try {
                console.warn(
                  `[SlideDeckEditor useEffect] Attempting to set DEFAULT_BOX_EDITOR_STATE for ${element.id} after error.`,
                );
                const fallbackState = nestedEditor.parseEditorState(
                  JSON.stringify(DEFAULT_BOX_EDITOR_STATE),
                );
                nestedEditor.setEditorState(fallbackState);
              } catch (fallbackError) {
                console.error(
                  `FATAL: Failed to set even DEFAULT_BOX_EDITOR_STATE_STRING for element ${element.id}:`,
                  fallbackError,
                );
              }
            }
          }
        } else if (isNewEditor) {
          // If it's a new editor and there was no pending markdown and no existing editorStateJSON (shouldn't happen with defaults)
          // Still ensure it gets a default state.
          console.warn(
            `[SlideDeckEditor] New editor for ${element.id} had no stateToSet. Applying default.`,
          );
          try {
            console.warn(
              `[SlideDeckEditor useEffect] Attempting to set DEFAULT_BOX_EDITOR_STATE for new editor ${element.id} (no initial state).`,
            );
            const defaultState = nestedEditor.parseEditorState(
              JSON.stringify(DEFAULT_BOX_EDITOR_STATE),
            );
            nestedEditor.setEditorState(defaultState);
          } catch (e) {
            console.error(
              `FATAL: Failed to set DEFAULT_BOX_EDITOR_STATE_STRING for new element ${element.id}:`,
              e,
            );
          }
        }
      });

      currentEditorsMapInRef.forEach((_, editorId) => {
        if (!newEditorIds.has(editorId)) {
          currentEditorsMapInRef.delete(editorId);
          editorsChanged = true;
        }
      });

      if (editorsChanged) {
        setActiveElementEditors(new Map(currentEditorsMapInRef));
      }
    } else {
      if (elementEditorsRef.current.size > 0) {
        elementEditorsRef.current.clear();
        setActiveElementEditors(new Map());
      }
    }
  }, [currentSlide, parentEditor, deckData, onDeckDataChange]); // Added deckData and onDeckDataChange dependencies

  const handleBoxContentChange = (
    elementId: string,
    newEditorState: EditorState,
  ) => {
    if (!currentSlide) return;
    const newElements = currentSlide.elements.map((el) =>
      el.id === elementId && el.kind === "box"
        ? {
            ...el,
            editorStateJSON: newEditorState.toJSON() as EditorStateJSON,
            pendingMarkdownContent: undefined,
            version: (el.version || 0) + 1,
          }
        : el,
    );
    const newSlides = deckData.slides.map((s) =>
      s.id === currentSlide.id ? { ...s, elements: newElements } : s,
    );
    const newDeckData = { ...deckData, slides: newSlides };
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
  };

  const navigateSlide = (direction: "next" | "prev") => {
    setSelectedElementId(null);
    let newIndex = currentSlideIndex;
    if (
      direction === "next" &&
      currentSlideIndex < deckData.slides.length - 1
    ) {
      newIndex = currentSlideIndex + 1;
    } else if (direction === "prev" && currentSlideIndex > 0) {
      newIndex = currentSlideIndex - 1;
    }

    const targetSlide = deckData.slides[newIndex];
    if (newIndex !== currentSlideIndex && targetSlide) {
      const newDeckData = {
        ...deckData,
        currentSlideId: targetSlide.id,
      };
      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    }
  };

  const addSlide = () => {
    setSelectedElementId(null); // Deselect element
    const newSlideId = `slide-${Date.now()}`;
    const newSlideData: SlideData = {
      id: newSlideId,
      elements: [],
    };
    const insertAtIndex = currentSlideIndex === -1 ? 0 : currentSlideIndex + 1;
    const newSlidesArray = [
      ...deckData.slides.slice(0, insertAtIndex),
      newSlideData,
      ...deckData.slides.slice(insertAtIndex),
    ];
    const newDeckData = {
      ...deckData,
      slides: newSlidesArray,
      currentSlideId: newSlideId,
    };
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
  };

  const handleAddBox = () => {
    if (!currentSlide) {
      alert("Please select or add a slide first!");
      return;
    }
    const newBoxId = `box-${Date.now()}`;
    const newBoxElement: SlideElementSpec = {
      kind: "box",
      id: newBoxId,
      x: 20,
      y: 20,
      width: 200,
      height: 100,
      editorStateJSON: DEFAULT_BOX_EDITOR_STATE,
    };

    const updatedElements = [...currentSlide.elements, newBoxElement];
    const updatedSlides = deckData.slides.map((s) =>
      s.id === currentSlide.id ? { ...s, elements: updatedElements } : s,
    );
    const newDeckData = { ...deckData, slides: updatedSlides };

    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
    setSelectedElementId(newBoxId);
  };

  const deleteSlide = () => {
    setSelectedElementId(null);
    if (!currentSlide || deckData.slides.length <= 1) {
      alert("Cannot delete the last slide or no slide selected.");
      return;
    }
    const newSlides = deckData.slides.filter((s) => s.id !== currentSlide.id);
    let newCurrentSlideId: string | null = null;

    if (newSlides.length > 0) {
      const deletedSlideIndex = deckData.slides.findIndex(
        (s) => s.id === currentSlide.id,
      );

      if (deletedSlideIndex > 0) {
        const slideBeforeDeleted = newSlides[deletedSlideIndex - 1];
        if (slideBeforeDeleted) {
          newCurrentSlideId = slideBeforeDeleted.id;
        } else {
          newCurrentSlideId = newSlides[0]?.id ?? null;
        }
      } else {
        newCurrentSlideId = newSlides[0]?.id ?? null;
      }
    } else {
      newCurrentSlideId = null;
    }

    const newDeckData = {
      ...deckData,
      slides: newSlides,
      currentSlideId: newCurrentSlideId,
    };
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 3,
      },
    }),
  );

  const handleElementUpdate = useCallback(
    (elementId: string, updates: Partial<SlideElementSpec>) => {
      if (!currentSlide) return;
      const newElements = currentSlide.elements.map((el) =>
        el.id === elementId ? { ...el, ...updates } : el,
      );
      const newSlides = deckData.slides.map((s) =>
        s.id === currentSlide.id ? { ...s, elements: newElements } : s,
      );
      const newDeckData = { ...deckData, slides: newSlides };
      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    },
    [currentSlide, deckData, onDeckDataChange],
  );

  const handleElementDelete = useCallback(
    (elementId: string) => {
      if (!currentSlide) return;
      const newElements = currentSlide.elements.filter(
        (el) => el.id !== elementId,
      );
      const newSlides = deckData.slides.map((s) =>
        s.id === currentSlide.id ? { ...s, elements: newElements } : s,
      );
      const newDeckData = { ...deckData, slides: newSlides };
      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    },
    [currentSlide, deckData, onDeckDataChange],
  );

  const handleBackgroundColorChange = useCallback(
    (elementId: string, newColor: string) => {
      if (!currentSlide) return;
      const newElements = currentSlide.elements.map((el) =>
        el.id === elementId ? { ...el, backgroundColor: newColor } : el,
      );
      const newSlides = deckData.slides.map((s) =>
        s.id === currentSlide.id ? { ...s, elements: newElements } : s,
      );
      const newDeckData = { ...deckData, slides: newSlides };
      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    },
    [currentSlide, deckData, onDeckDataChange],
  );

  const handleSlideBackgroundColorChange = useCallback(
    (newColor: string) => {
      if (!currentSlide) return;
      const updatedSlideData = { ...currentSlide, backgroundColor: newColor };
      const newSlides = deckData.slides.map((s) =>
        s.id === currentSlide.id ? updatedSlideData : s,
      );
      const newDeckData = { ...deckData, slides: newSlides };
      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    },
    [currentSlide, deckData, onDeckDataChange],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, delta } = event;
      if (!currentSlide || !active || (!delta.x && !delta.y)) return;

      const elementId = active.id as string;

      const originalElement = currentSlide.elements.find(
        (el) => el.id === elementId,
      );
      if (!originalElement) return;

      const updates = {
        x: originalElement.x + delta.x,
        y: originalElement.y + delta.y,
      };
      handleElementUpdate(elementId, updates);
    },
    [currentSlide, handleElementUpdate],
  );

  const deselectElement = () => {
    setSelectedElementId(null);
  };

  if (!currentSlide) {
    return (
      <div className="p-4 border border-dashed border-destructive text-destructive-foreground">
        {deckData.slides.length === 0
          ? "No slides in this deck. "
          : "Error: Current slide not found. "}
        <Button onClick={addSlide} variant="outline" size="sm" className="ml-2">
          <PlusCircleIcon className="mr-2 h-4 w-4" /> Add Slide
        </Button>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="slide-deck-display bg-muted/20 p-2 flex flex-col">
        <div className="w-full flex justify-center mb-2">
          <ToolbarPlugin setIsLinkEditMode={setIsLinkEditMode} />
        </div>
        <div
          className="slide-canvas-area bg-background border border-border rounded w-[1280px] h-[720px] mb-2 relative flex-grow overflow-hidden"
          style={{
            backgroundColor: currentSlide.backgroundColor || "transparent",
          }}
          onClick={deselectElement}
        >
          {currentSlide.elements.map((element) => {
            const nestedEditor = activeElementEditors.get(element.id);
            if (element.kind === "box" && nestedEditor) {
              return (
                <React.Fragment key={element.id}>
                  <Dialog
                    open={
                      showColorPicker && editingElementIdForColor === element.id
                    }
                    onOpenChange={(isOpen) => {
                      if (!isOpen) setEditingElementIdForColor(null);
                      setShowColorPicker(isOpen);
                    }}
                  >
                    <DialogContent className="p-4">
                      <DialogTitle>Box Background Color</DialogTitle>
                      <ColorPickerContent
                        color={element.backgroundColor || "#ffffff"}
                        onChange={(newColor) => {
                          handleBackgroundColorChange(element.id, newColor);
                        }}
                      />
                    </DialogContent>
                  </Dialog>
                  <DraggableBoxWrapper
                    key={`${element.id}-draggable`}
                    element={element}
                    nestedEditor={nestedEditor}
                    onBoxContentChange={handleBoxContentChange}
                    historyState={historyState}
                    isSelected={selectedElementId === element.id}
                    onSelect={setSelectedElementId}
                    onElementUpdate={handleElementUpdate}
                    onElementDelete={handleElementDelete}
                    setShowColorPicker={(show) => {
                      setEditingElementIdForColor(element.id);
                      setShowColorPicker(show);
                    }}
                    isLinkEditMode={isLinkEditMode}
                    setIsLinkEditMode={setIsLinkEditMode}
                    deselectElement={deselectElement}
                  />
                </React.Fragment>
              );
            }
            return null;
          })}
        </div>

        {/* Dialog for Slide Background Color Picker */}
        <Dialog
          open={showSlideBgColorPicker}
          onOpenChange={setShowSlideBgColorPicker}
        >
          <DialogContent className="p-4">
            <DialogHeader>
              <DialogTitle>Slide Background Color</DialogTitle>
            </DialogHeader>
            <ColorPickerContent
              color={currentSlide.backgroundColor || "#ffffff"}
              onChange={handleSlideBackgroundColorChange}
            />
          </DialogContent>
        </Dialog>

        <div className="slide-controls flex items-center justify-between p-2 mt-auto">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigateSlide("prev")}
              disabled={currentSlideIndex <= 0}
              variant="outline"
              size="icon"
              title="Previous Slide"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentSlideIndex === -1
                ? "No Slides"
                : `Slide ${currentSlideIndex + 1} of ${deckData.slides.length}`}
            </span>
            <Button
              onClick={() => navigateSlide("next")}
              disabled={
                currentSlideIndex === -1 ||
                currentSlideIndex >= deckData.slides.length - 1
              }
              variant="outline"
              size="icon"
              title="Next Slide"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleAddBox}
              variant="outline"
              size="sm"
              className="mr-4"
            >
              <PlusSquareIcon className="mr-2 h-4 w-4" /> Add Box
            </Button>
            <Button
              onClick={() => setShowSlideBgColorPicker(true)}
              variant="outline"
              size="sm"
              className="mr-4"
            >
              <PaintBucketIcon className="mr-2 h-4 w-4" /> Set Slide Background
            </Button>
            <Button onClick={addSlide} variant="outline" size="sm">
              <PlusCircleIcon className="mr-2 h-4 w-4" /> Add Slide
            </Button>
            <Button
              onClick={deleteSlide}
              variant="destructive"
              size="sm"
              disabled={deckData.slides.length <= 1}
            >
              <Trash2Icon className="mr-2 h-4 w-4" /> Delete Slide
            </Button>
          </div>
        </div>
      </div>
    </DndContext>
  );
}
