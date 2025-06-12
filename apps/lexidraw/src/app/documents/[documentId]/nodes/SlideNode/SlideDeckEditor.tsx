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
  SlideNode,
  DeckStrategicMetadata,
  SlideStrategicMetadata,
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
  ImagePlusIcon,
  BarChartBigIcon,
  PencilIcon,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronsDownUp,
  ChevronsUpDown,
  InfoIcon,
} from "lucide-react";
import {
  type EditorState,
  createEditor,
  ParagraphNode,
  TextNode,
  LineBreakNode,
  LexicalEditor,
  $getNodeByKey,
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
// import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
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
import {
  useLexicalTransformation,
  useEditorRegistry,
} from "../../context/editors-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  InsertImageDialog,
  type InsertImagePayload,
} from "../../plugins/ImagePlugin";
import { ChartNode } from "../ChartNode";
import DynamicChartRenderer from "../ChartNode/DynamicChartRenderer";
import type { ChartConfig } from "~/components/ui/chart";
import SlideChartEditModal from "./SlideChartEditModal";
import ChartPlugin from "../../plugins/ChartPlugin";
import SlideDeckMetadataModal from "./SlideDeckMetadataModal";
import { useMetadataModal } from "./MetadataModalContext";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "~/components/ui/tooltip";

import { useKeyedSerialization } from "../../plugins/LlmChatPlugin/use-serialized-editor-state";
import { isEqual } from "@packages/lib";
import { BlurPlugin } from "./BlurPlugin";
import { useEmptyContent } from "../../initial-content";

export const NESTED_EDITOR_NODES = [
  ChartNode,
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
  deckNodeKey: string;
  slideId: string;
  element: SlideElementSpec;
  nestedEditor: LexicalEditor | null;
  onBoxContentChange: (elementId: string, newEditorState: EditorState) => void;
  historyState?: ReturnType<typeof useSharedHistoryContext>["historyState"];
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
  setShowChartEditModal: Dispatch<SetStateAction<boolean>>;
  setEditingChartElement: Dispatch<
    SetStateAction<Extract<SlideElementSpec, { kind: "chart" }> | null>
  >;
  onBringForward: (elementId: string) => void;
  onSendBackward: (elementId: string) => void;
  onBringToFront: (elementId: string) => void;
  onSendToBack: (elementId: string) => void;
}

const DraggableBoxWrapper: React.FC<DraggableBoxWrapperProps> = ({
  deckNodeKey,
  slideId,
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
  setShowChartEditModal,
  setEditingChartElement,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
}) => {
  const { attributes, listeners, setNodeRef, transform, active } = useDraggable(
    {
      id: element.id,
      disabled: element.kind === "box" && isLinkEditMode,
    },
  );
  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement>();

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

  const { registerEditor, unregisterEditor } = useEditorRegistry();
  const editorKey = `${deckNodeKey}/${slideId}/${element.id}`;

  useEffect(() => {
    if (element.kind === "box" && nestedEditor) {
      const originalStateRoot = element.editorStateJSON?.root;
      registerEditor(editorKey, nestedEditor, originalStateRoot);
      return () => {
        unregisterEditor(editorKey);
      };
    }
    return () => {
      /**  do nothing */
    };
  }, [
    nestedEditor,
    editorKey,
    registerEditor,
    unregisterEditor,
    element.kind,
    // @ts-expect-error - editorStateJSON should exist for nested editors
    element.editorStateJSON?.root,
  ]);

  const isDragging = active?.id === element.id;

  const style: React.CSSProperties = {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    ...(element.kind === "box"
      ? {
          minHeight: element.height,
          height: "auto",
          overflowX: "hidden",
          overflowY: "hidden",
        }
      : {
          height: element.height,
          overflow: "hidden",
        }),
    border: "1px solid #ccc",
    backgroundColor:
      element.kind === "box"
        ? element.backgroundColor || "white"
        : "transparent",
    boxSizing: "border-box",
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: isSelected || isDragging ? element.zIndex + 1000 : element.zIndex,
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
      minH = 20;

    if (corner.includes("w") && typeof initialElement.width === "number") {
      newW = Math.max(minW, initialElement.width - dx);
      newX = initialElement.x + (initialElement.width - newW);
    } else if (
      corner.includes("e") &&
      typeof initialElement.width === "number"
    ) {
      newW = Math.max(minW, initialElement.width + dx);
    }
    if (corner.includes("n") && typeof initialElement.height === "number") {
      newH = Math.max(minH, initialElement.height - dy);
      newY = initialElement.y + (initialElement.height - newH);
    } else if (
      corner.includes("s") &&
      typeof initialElement.height === "number"
    ) {
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
              {element.kind === "box" && (
                <DropdownMenuItem
                  onClick={() => {
                    deselectElement();
                    setShowColorPicker(true);
                  }}
                >
                  <PaintBucketIcon className="h-4 w-4 mr-2" />
                  Background Color
                </DropdownMenuItem>
              )}
              {element.kind === "chart" && (
                <DropdownMenuItem
                  onClick={() => {
                    setEditingChartElement(
                      element as Extract<SlideElementSpec, { kind: "chart" }>,
                    );
                    setShowChartEditModal(true);
                    deselectElement();
                  }}
                >
                  <PencilIcon className="h-4 w-4 mr-2" />
                  Edit Chart
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  onBringForward(element.id);
                  deselectElement();
                }}
              >
                <ChevronsUpDown className="h-4 w-4 mr-2" />
                Bring Forward
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onSendBackward(element.id);
                  deselectElement();
                }}
              >
                <ChevronsDownUp className="h-4 w-4 mr-2" />
                Send Backward
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onBringToFront(element.id);
                  deselectElement();
                }}
              >
                <ArrowUpToLine className="h-4 w-4 mr-2" />
                Bring to Front
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  onSendToBack(element.id);
                  deselectElement();
                }}
              >
                <ArrowDownToLine className="h-4 w-4 mr-2" />
                Send to Back
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {element.kind === "box" && nestedEditor && (
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
              <ChartPlugin />
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
              <BlurPlugin
                onBlur={(editorState) =>
                  onBoxContentChange(element.id, editorState)
                }
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
          )}
          {element.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={element.url}
              alt={`Slide content ${element.id}`}
              className="w-full h-full object-contain pointer-events-none"
            />
          )}
          {element.kind === "chart" && (
            <DynamicChartRenderer
              chartType={element.chartType}
              data={JSON.parse(element.chartData) as unknown[]}
              config={JSON.parse(element.chartConfig) as ChartConfig}
              width={element.width}
              height={element.height}
            />
          )}
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

interface SlideDeckEditorProps {
  initialData: SlideDeckData;
  onDeckDataChange: (data: SlideDeckData) => void;
  parentEditor: LexicalEditor;
  nodeKey: string;
}

export default function SlideDeckEditorComponent({
  initialData,
  onDeckDataChange,
  parentEditor,
  nodeKey,
}: SlideDeckEditorProps): JSX.Element {
  const [deckData, setDeckData] = useState<SlideDeckData>(initialData);
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
  const [showImageInsertDialog, setShowImageInsertDialog] = useState(false);
  const [activeEditorForImageInsert, setActiveEditorForImageInsert] =
    useState<LexicalEditor | null>(null);

  // State for Chart Edit Modal
  const [showChartEditModal, setShowChartEditModal] = useState(false);
  const [editingChartElement, setEditingChartElement] = useState<Extract<
    SlideElementSpec,
    { kind: "chart" }
  > | null>(null);

  const { openModal } = useMetadataModal();
  const [editor] = useLexicalComposerContext();
  const { serializeEditorStateWithKeys } = useKeyedSerialization();

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

  const EMPTY_CONTENT_FOR_NEW_BOXES = useEmptyContent();

  const { transformToLexicalSourcedJSON } = useLexicalTransformation();

  useEffect(() => {
    const newActiveElementEditors = new Map<string, LexicalEditor>();
    const currentEditorIdsInSlide = new Set<string>();

    if (currentSlide?.elements) {
      currentSlide.elements.forEach((element) => {
        if (element.kind === "box") {
          currentEditorIdsInSlide.add(element.id);
          let editorInstance = elementEditorsRef.current.get(element.id);
          const isNewEditor = !editorInstance;

          if (isNewEditor) {
            editorInstance = createEditor({
              parentEditor: parentEditor,
              nodes: NESTED_EDITOR_NODES,
              theme: editorTheme,
              onError: (error) =>
                console.error(`Error in nested for ${element.id}:`, error),
            });
            elementEditorsRef.current.set(element.id, editorInstance);
          }

          if (!editorInstance) return;
          newActiveElementEditors.set(element.id, editorInstance);

          const incomingKeyedState = element.editorStateJSON;

          const currentEditorState = editorInstance.getEditorState();
          const currentLiveLexicalJSON = currentEditorState.toJSON();

          const incomingLexicalJSON = transformToLexicalSourcedJSON(
            incomingKeyedState || EMPTY_CONTENT_FOR_NEW_BOXES,
          );

          if (
            !incomingLexicalJSON.root ||
            (Array.isArray(incomingLexicalJSON.root.children) &&
              incomingLexicalJSON.root.children.length === 0)
          ) {
            console.warn(
              `[SlideDeckEditorComponent useEffect] Incoming Lexical JSON for box ${element.id} has an empty root. This could lead to an empty editor.`,
              {
                isNewEditor,
                slideId: currentSlide.id,
                incomingKeyedState: JSON.stringify(incomingKeyedState),
                transformedLexicalJSON: JSON.stringify(incomingLexicalJSON),
              },
            );
          }

          if (
            isNewEditor ||
            !isEqual(currentLiveLexicalJSON, incomingLexicalJSON)
          ) {
            try {
              const newLexicalState =
                editorInstance.parseEditorState(incomingLexicalJSON);
              if (newLexicalState.isEmpty()) {
                console.error(
                  `[SlideDeckEditorComponent useEffect] CRITICAL: Setting an EMPTY editor state for box ${element.id}. This can lead to unexpected behavior or data loss.`,
                  {
                    elementId: element.id,
                    parsedStateIsEmpty: newLexicalState.isEmpty(),
                    fromKeyedJSON: JSON.stringify(incomingKeyedState, null, 2),
                    fromLexicalJSON: JSON.stringify(
                      incomingLexicalJSON,
                      null,
                      2,
                    ),
                  },
                );
              }
              editorInstance.setEditorState(newLexicalState);
            } catch (e) {
              console.error(
                `[SlideDeckEditorComponent useEffect] Error parsing/setting state for box ${element.id}:`,
                e,
                "Incoming Lexical JSON:",
                incomingLexicalJSON,
                "Original Keyed State:",
                incomingKeyedState,
              );
            }
          }
        }
      });
    }

    setActiveElementEditors(newActiveElementEditors);
  }, [
    currentSlide?.id,
    currentSlide?.elements,
    parentEditor,
    EMPTY_CONTENT_FOR_NEW_BOXES,
    transformToLexicalSourcedJSON,
  ]);

  useEffect(() => {
    if (!isEqual(initialData, deckData)) {
      setDeckData(initialData);
    }
  }, [initialData, deckData]);

  const handleBoxContentChange = useCallback(
    (elementId: string, editorStateOnBlur: EditorState) => {
      if (!currentSlide || !serializeEditorStateWithKeys) return;

      const newKeyedStateToStore =
        serializeEditorStateWithKeys(editorStateOnBlur);
      if (!newKeyedStateToStore) {
        console.error(`Failed to serialize box ${elementId} with keys.`);
        return;
      }

      const root = newKeyedStateToStore.root;
      if (
        !root ||
        (Array.isArray(root.children) && root.children.length === 0) ||
        (Array.isArray(root.children) &&
          root.children.length === 1 &&
          root.children[0]?.type === "paragraph" &&
          root.children[0]?.children?.length === 0)
      ) {
        console.warn(
          `[SlideDeckEditorComponent handleBoxContentChange] About to save an empty or minimal editor state for box ${elementId}. This might be unintentional.`,
          {
            slideId: currentSlide.id,
            editorStateOnBlurJSON: JSON.stringify(editorStateOnBlur.toJSON()),
            newKeyedStateToStore: JSON.stringify(newKeyedStateToStore),
          },
        );
      }

      // The guard for comparing current stored state with new state can be kept,
      // though it's less critical if this function is primarily called on blur.
      const currentElement = currentSlide.elements.find(
        (el) => el.id === elementId && el.kind === "box",
      ) as Extract<SlideElementSpec, { kind: "box" }> | undefined;

      if (currentElement?.editorStateJSON) {
        const currentStoredKeylessRep = transformToLexicalSourcedJSON(
          currentElement.editorStateJSON,
        );
        const newKeylessRep =
          transformToLexicalSourcedJSON(newKeyedStateToStore);

        if (
          JSON.stringify(currentStoredKeylessRep) ===
          JSON.stringify(newKeylessRep)
        ) {
          return; // Logical content is the same, bail out
        }
      }

      // Ensure new arrays are created when setting deckData
      const newElements = currentSlide.elements.map(
        (el) =>
          el.id === elementId && el.kind === "box"
            ? {
                ...el,
                editorStateJSON: newKeyedStateToStore,
                version: (el.version || 0) + 1,
              }
            : { ...el }, // Create new references for all elements in the current slide
      );
      // Create new arrays for slides and elements to ensure React detects changes
      const newSlides = deckData.slides.map(
        (s) =>
          s.id === currentSlide.id
            ? { ...s, elements: newElements } // Use the newElements array with new object references
            : { ...s, elements: s.elements ? [...s.elements] : [] }, // New array for other slides' elements too
      );
      const newDeckData = { ...deckData, slides: newSlides };

      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    },
    [
      currentSlide,
      serializeEditorStateWithKeys,
      deckData,
      onDeckDataChange,
      transformToLexicalSourcedJSON,
    ],
  );

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
      console.log(
        `[SlideDeckEditor] Navigating to slide ${newIndex}.`,
        newDeckData,
      );
      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    }
  };

  const addSlide = () => {
    setSelectedElementId(null); // deselect element
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
    console.log(`[SlideDeckEditor] Adding new slide.`, { newDeckData });
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
  };

  const getNextZIndex = useCallback((elements: SlideElementSpec[]): number => {
    if (!elements || elements.length === 0) {
      return 0;
    }
    return Math.max(...elements.map((el) => el.zIndex), -1) + 1;
  }, []);

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
      editorStateJSON: EMPTY_CONTENT_FOR_NEW_BOXES,
      zIndex: getNextZIndex(currentSlide.elements),
    };

    const updatedElements = [...currentSlide.elements, newBoxElement];
    const updatedSlides = deckData.slides.map((s) =>
      s.id === currentSlide.id ? { ...s, elements: updatedElements } : s,
    );
    const newDeckData = { ...deckData, slides: updatedSlides };

    console.log(`[SlideDeckEditor] Adding new box.`, { newDeckData });
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
    setSelectedElementId(newBoxId);
  };

  const handleAddChart = () => {
    if (!currentSlide) {
      alert("Please select or add a slide first!");
      return;
    }
    const newChartId = `chart-${Date.now()}`;
    const newChartElement: SlideElementSpec = {
      kind: "chart",
      id: newChartId,
      x: 40, // default position
      y: 40,
      width: 400, // default size
      height: 300,
      chartType: "bar", // default chart type
      chartData: "[]", // default empty data
      chartConfig: "{}", // default empty config
      zIndex: getNextZIndex(currentSlide.elements),
    };

    const updatedElements = [...currentSlide.elements, newChartElement];
    const updatedSlides = deckData.slides.map((s) =>
      s.id === currentSlide.id ? { ...s, elements: updatedElements } : s,
    );
    const newDeckData = { ...deckData, slides: updatedSlides };

    console.log(`[SlideDeckEditor] Adding new chart.`, { newDeckData });
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
    setSelectedElementId(newChartId);
  };

  const openImageInsertDialog = () => {
    setActiveEditorForImageInsert(parentEditor);
    setShowImageInsertDialog(true);
  };

  const handleInsertImageFromDialog = (payload: InsertImagePayload) => {
    if (!currentSlide) {
      console.error("Cannot insert image, no current slide selected.");
      setShowImageInsertDialog(false);
      return;
    }
    const newImageId = `image-${Date.now()}`;
    const newImageElement: SlideElementSpec = {
      kind: "image",
      id: newImageId,
      x: 30,
      y: 30,
      width: payload.width || 250,
      height: payload.height || 50,
      url: payload.src,
      zIndex: getNextZIndex(currentSlide.elements),
    };

    const updatedElements = [...currentSlide.elements, newImageElement];
    const updatedSlides = deckData.slides.map((s) =>
      s.id === currentSlide.id ? { ...s, elements: updatedElements } : s,
    );
    const newDeckData = { ...deckData, slides: updatedSlides };

    console.log(`[SlideDeckEditor] Inserting image.`, { newDeckData });
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
    setSelectedElementId(newImageId);
    setShowImageInsertDialog(false);
  };

  const handleElementDelete = useCallback(
    (elementId: string) => {
      if (!currentSlide) return;

      const reorderAndNormalizeZIndexesOnDelete = (
        elements: SlideElementSpec[],
      ): SlideElementSpec[] => {
        const sortedElements = [...elements].sort(
          (a, b) => a.zIndex - b.zIndex,
        );
        return sortedElements.map((el, index) => ({ ...el, zIndex: index }));
      };

      const newElements = currentSlide.elements.filter(
        (el) => el.id !== elementId,
      );
      const reorderedElements =
        reorderAndNormalizeZIndexesOnDelete(newElements);

      const newSlides = deckData.slides.map((s) =>
        s.id === currentSlide.id ? { ...s, elements: reorderedElements } : s,
      );
      const newDeckData = { ...deckData, slides: newSlides };
      console.log(`[SlideDeckEditor] Deleting element ${elementId}.`, {
        newDeckData,
      });
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
      console.log(
        `[SlideDeckEditor] Changing background color for element ${elementId}.`,
        { newDeckData },
      );
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
      console.log(
        `[SlideDeckEditor] Changing background color for slide ${currentSlide.id}.`,
        { newDeckData },
      );
      setDeckData(newDeckData);
      onDeckDataChange(newDeckData);
    },
    [currentSlide, deckData, onDeckDataChange],
  );

  const handleElementUpdate = useCallback(
    (
      elementId: string,
      updates: Partial<Pick<SlideElementSpec, "x" | "y" | "width" | "height">>,
    ) => {
      if (!currentSlide) return;
      const newElements = currentSlide.elements.map((el) =>
        el.id === elementId ? { ...el, ...updates } : el,
      );
      const newSlides = deckData.slides.map((s) =>
        s.id === currentSlide.id ? { ...s, elements: newElements } : s,
      );
      const newDeckData = { ...deckData, slides: newSlides };
      console.log(`[SlideDeckEditor] Updating element ${elementId}.`, {
        newDeckData,
      });
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

  const handleSaveChartChanges = (
    updatedChartElement: Extract<SlideElementSpec, { kind: "chart" }>,
  ) => {
    if (!currentSlide || !editingChartElement) return;

    const newElements = currentSlide.elements.map((el) =>
      el.id === editingChartElement.id ? updatedChartElement : el,
    );
    const newSlides = deckData.slides.map((s) =>
      s.id === currentSlide.id ? { ...s, elements: newElements } : s,
    );
    const newDeckData = { ...deckData, slides: newSlides };
    console.log(
      `[SlideDeckEditor] Saving chart changes for element ${editingChartElement.id}.`,
      { newDeckData },
    );
    setDeckData(newDeckData);
    onDeckDataChange(newDeckData);
    setShowChartEditModal(false);
    setEditingChartElement(null);
  };

  // helper function to reorder elements and normalize z-indexes
  const reorderAndNormalizeZIndexes = useCallback(
    (elements: SlideElementSpec[]): SlideElementSpec[] => {
      const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex);
      return sortedElements.map((el, index) => ({ ...el, zIndex: index }));
    },
    [],
  );

  // z-index manipulation functions
  const createZIndexChanger = useCallback(
    (
      direction: "forward" | "backward" | "front" | "back",
    ): ((elementId: string) => void) => {
      return (elementId: string) => {
        if (!currentSlide) return;

        const newElements = [...currentSlide.elements];
        const targetElementIndex = newElements.findIndex(
          (el) => el.id === elementId,
        );
        if (targetElementIndex === -1) return;

        const targetElement = newElements[targetElementIndex];
        if (!targetElement) return;

        if (direction === "forward") {
          const elementAbove = newElements
            .filter((el) => el.zIndex > targetElement.zIndex)
            .sort((a, b) => a.zIndex - b.zIndex)[0];
          if (elementAbove) {
            // swap zIndexes
            const tempZ = targetElement.zIndex;
            newElements[targetElementIndex] = {
              ...targetElement,
              zIndex: elementAbove.zIndex,
            };
            const elementAboveIndex = newElements.findIndex(
              (el) => el.id === elementAbove.id,
            );
            if (elementAboveIndex !== -1) {
              newElements[elementAboveIndex] = {
                ...elementAbove,
                zIndex: tempZ,
              };
            }
          }
        } else if (direction === "backward") {
          const elementBelow = newElements
            .filter((el) => el.zIndex < targetElement.zIndex)
            .sort((a, b) => b.zIndex - a.zIndex)[0];
          if (elementBelow) {
            // swap zIndexes
            const tempZ = targetElement.zIndex;
            newElements[targetElementIndex] = {
              ...targetElement,
              zIndex: elementBelow.zIndex,
            };
            const elementBelowIndex = newElements.findIndex(
              (el) => el.id === elementBelow.id,
            );
            if (elementBelowIndex !== -1) {
              newElements[elementBelowIndex] = {
                ...elementBelow,
                zIndex: tempZ,
              };
            }
          }
        } else if (direction === "front") {
          const maxZ = Math.max(...newElements.map((el) => el.zIndex), -1); // ensure there's always a number
          if (targetElement.zIndex < maxZ || newElements.length === 1) {
            newElements[targetElementIndex] = {
              ...targetElement,
              zIndex: maxZ + 1, // temporarily make it highest
            };
          }
        } else if (direction === "back") {
          const minZ = Math.min(
            ...newElements.map((el) => el.zIndex),
            Infinity,
          ); // ensure there's always a number
          if (targetElement.zIndex > minZ || newElements.length === 1) {
            newElements[targetElementIndex] = {
              ...targetElement,
              zIndex: minZ - 1, // temporarily make it lowest
            };
          }
        }

        const finalElements = reorderAndNormalizeZIndexes(newElements);
        const newSlides = deckData.slides.map((s) =>
          s.id === currentSlide.id ? { ...s, elements: finalElements } : s,
        );
        const newDeckData = { ...deckData, slides: newSlides };
        console.log(`[SlideDeckEditor] Changing z-index for ${elementId}.`, {
          newDeckData,
        });
        setDeckData(newDeckData);
        onDeckDataChange(newDeckData);
      };
    },
    [currentSlide, deckData, onDeckDataChange, reorderAndNormalizeZIndexes],
  );

  const handleBringForward = createZIndexChanger("forward");
  const handleSendBackward = createZIndexChanger("backward");
  const handleBringToFront = createZIndexChanger("front");
  const handleSendToBack = createZIndexChanger("back");

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
    console.log(
      `[SlideDeckEditor] Deleting slide ${currentSlide.id}.`,
      newDeckData,
    );
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

  const handleSaveMetadata = ({
    updatedMeta,
    currentSlideId,
  }: {
    updatedMeta: DeckStrategicMetadata | SlideStrategicMetadata | undefined;
    currentSlideId: string | null;
  }) => {
    editor.update(() => {
      const deckNode = $getNodeByKey<SlideNode>(nodeKey);
      if (SlideNode.$isSlideDeckNode(deckNode)) {
        const currentData = deckNode.getData();
        let newDeckMetadata = currentData.deckMetadata;
        const newSlides = [...currentData.slides];

        if (currentSlideId === null) {
          newDeckMetadata = updatedMeta as DeckStrategicMetadata | undefined;
          console.log("Deck metadata updated.");
        } else {
          const slideIndex = newSlides.findIndex(
            (s) => s.id === currentSlideId,
          );
          if (slideIndex !== -1) {
            const slideToUpdate = newSlides[slideIndex];
            if (slideToUpdate && slideToUpdate.id) {
              newSlides[slideIndex] = {
                ...slideToUpdate,
                slideMetadata: updatedMeta as
                  | SlideStrategicMetadata
                  | undefined,
              };
              console.log(
                `Slide metadata updated for slide ID: ${currentSlideId}`,
              );
            } else {
              console.warn(
                `Slide to update (ID: ${currentSlideId}) or its ID is undefined, cannot save metadata.`,
              );
            }
          } else {
            console.warn(
              `Slide with ID ${currentSlideId} not found, cannot save metadata.`,
            );
            return;
          }
        }

        deckNode.setData({
          ...currentData,
          deckMetadata: newDeckMetadata,
          slides: newSlides,
        });
      }
    });
  };

  if (!currentSlide && deckData.slides.length > 0) {
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
            backgroundColor: currentSlide?.backgroundColor || "transparent",
          }}
          onClick={deselectElement}
        >
          {currentSlide?.elements.map((element) => {
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
                    deckNodeKey={nodeKey}
                    slideId={currentSlide.id}
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
                    setShowChartEditModal={setShowChartEditModal}
                    setEditingChartElement={setEditingChartElement}
                    onBringForward={handleBringForward}
                    onSendBackward={handleSendBackward}
                    onBringToFront={handleBringToFront}
                    onSendToBack={handleSendToBack}
                  />
                </React.Fragment>
              );
            } else if (element.kind === "image") {
              return (
                <DraggableBoxWrapper
                  deckNodeKey={nodeKey}
                  slideId={currentSlide.id}
                  key={`${element.id}-draggable`}
                  element={element}
                  nestedEditor={null}
                  onBoxContentChange={() => {
                    /* no-op for images */
                  }}
                  isSelected={selectedElementId === element.id}
                  onSelect={setSelectedElementId}
                  onElementUpdate={handleElementUpdate}
                  onElementDelete={handleElementDelete}
                  setShowColorPicker={() => {
                    /* no-op for images, or handle differently */
                  }}
                  isLinkEditMode={false}
                  setIsLinkEditMode={() => {
                    /* no-op for images */
                  }}
                  deselectElement={deselectElement}
                  setShowChartEditModal={setShowChartEditModal}
                  setEditingChartElement={setEditingChartElement}
                  onBringForward={handleBringForward}
                  onSendBackward={handleSendBackward}
                  onBringToFront={handleBringToFront}
                  onSendToBack={handleSendToBack}
                />
              );
            } else if (element.kind === "chart") {
              return (
                <DraggableBoxWrapper
                  deckNodeKey={nodeKey}
                  slideId={currentSlide.id}
                  key={`${element.id}-draggable`}
                  element={element}
                  nestedEditor={null}
                  onBoxContentChange={() => {
                    /* no-op for charts, content managed via modal */
                  }}
                  isSelected={selectedElementId === element.id}
                  onSelect={setSelectedElementId}
                  onElementUpdate={handleElementUpdate}
                  onElementDelete={handleElementDelete}
                  setShowColorPicker={() => {
                    /* no-op for charts, or handle chart-specific styling differently */
                  }}
                  isLinkEditMode={false}
                  setIsLinkEditMode={() => {
                    /* no-op */
                  }}
                  deselectElement={deselectElement}
                  setShowChartEditModal={setShowChartEditModal}
                  setEditingChartElement={
                    setEditingChartElement as Dispatch<
                      SetStateAction<Extract<
                        SlideElementSpec,
                        { kind: "chart" }
                      > | null>
                    >
                  }
                  onBringForward={handleBringForward}
                  onSendBackward={handleSendBackward}
                  onBringToFront={handleBringToFront}
                  onSendToBack={handleSendToBack}
                />
              );
            }
            return null;
          })}
        </div>

        {/* dialog for Slide Background Color Picker */}
        <Dialog
          open={showSlideBgColorPicker}
          onOpenChange={setShowSlideBgColorPicker}
        >
          <DialogContent className="p-4">
            <DialogHeader>
              <DialogTitle>Slide Background Color</DialogTitle>
            </DialogHeader>
            <ColorPickerContent
              color={currentSlide?.backgroundColor || "#ffffff"}
              onChange={handleSlideBackgroundColorChange}
            />
          </DialogContent>
        </Dialog>

        {/* dialog for Image Insertion */}
        {showImageInsertDialog && activeEditorForImageInsert && (
          <Dialog
            open={showImageInsertDialog}
            onOpenChange={setShowImageInsertDialog}
          >
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Insert Image into Slide</DialogTitle>
              </DialogHeader>
              <InsertImageDialog
                activeEditor={activeEditorForImageInsert}
                onClose={() => setShowImageInsertDialog(false)}
                onInsert={handleInsertImageFromDialog}
              />
            </DialogContent>
          </Dialog>
        )}

        {/* chart Edit Modal */}
        {showChartEditModal && editingChartElement && (
          <SlideChartEditModal
            isOpen={showChartEditModal}
            chartElement={editingChartElement}
            onCancel={() => {
              setShowChartEditModal(false);
              setEditingChartElement(null);
            }}
            onSave={handleSaveChartChanges}
          />
        )}

        <SlideDeckMetadataModal onSave={handleSaveMetadata} />

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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() =>
                      openModal(
                        currentSlide?.slideMetadata,
                        currentSlide?.id || null,
                      )
                    }
                    variant="outline"
                    size="icon"
                    disabled={!currentSlide}
                  >
                    <InfoIcon className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Slide Page Metadata</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              onClick={handleAddBox}
              variant="outline"
              size="sm"
              className="mr-2"
            >
              <PlusSquareIcon className="mr-2 h-4 w-4" /> Add Box
            </Button>
            <Button
              onClick={openImageInsertDialog}
              variant="outline"
              size="sm"
              className="mr-2"
            >
              <ImagePlusIcon className="mr-2 h-4 w-4" /> Add Image
            </Button>
            <Button
              onClick={handleAddChart}
              variant="outline"
              size="sm"
              className="mr-4"
            >
              <BarChartBigIcon className="mr-2 h-4 w-4" /> Add Chart
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
