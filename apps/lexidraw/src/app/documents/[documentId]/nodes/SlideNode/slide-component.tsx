import React, {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
} from "react";
import {
  $getNodeByKey,
  LexicalEditor,
  NodeKey,
  type EditorState,
  KEY_DELETE_COMMAND,
  KEY_BACKSPACE_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  createEditor,
  ParagraphNode,
  TextNode,
  LineBreakNode,
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
// tweet
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
import TreeViewPlugin from "../../plugins/TreeViewPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import { useSettings } from "../../context/settings-context";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import { SlidePageNode, type SlideElementSpec } from "./SlidePageNode";
import { useActiveSlideKey, useSlideParentEditor } from "./slide-context";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  DragEndEvent,
} from "@dnd-kit/core";
import { mergeRegister } from "@lexical/utils";
import { cn } from "~/lib/utils";
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
import { SlideScaleWrapper } from "./slide-scale-wrapper";

interface SlideComponentProps {
  nodeKey: NodeKey;
  editor: LexicalEditor;
}

export const SlideComponent: React.FC<SlideComponentProps> = ({ nodeKey }) => {
  const {
    activeKey,
    slideKeys,
    selectedElementId,
    setSelectedElementId,
    deckEditor: parentEditor,
    setDeckElement,
  } = useActiveSlideKey();

  const slideIndex = useMemo(
    () => slideKeys.indexOf(nodeKey),
    [slideKeys, nodeKey],
  );
  const activeIndex = useMemo(
    () => (activeKey ? slideKeys.indexOf(activeKey) : -1),
    [slideKeys, activeKey],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const isThisSlideActive = activeIndex !== -1 && activeIndex === slideIndex;

  useEffect(() => {
    // Only the active slide should perform this action.
    if (isThisSlideActive) {
      // Find the deck element and report it up to the plugin's state.
      const deck = rootRef.current?.closest(".slide-deck-lexical-node");
      setDeckElement(deck as HTMLElement | null);
    }
  }, [isThisSlideActive, setDeckElement]);

  const [currentElements, setCurrentElements] = useState<SlideElementSpec[]>(
    [],
  );

  useEffect(() => {
    if (!parentEditor) {
      setCurrentElements([]);
      return;
    }
    const editorState = parentEditor.getEditorState();
    editorState.read(() => {
      const node = $getNodeByKey(nodeKey);
      if (SlidePageNode.$isSlidePageNode(node)) {
        setCurrentElements([...node.__elements]);
      } else {
        setCurrentElements([]);
      }
    });
  }, [parentEditor, nodeKey]);

  useEffect(() => {
    if (!parentEditor) return;
    const unregister = parentEditor.registerMutationListener(
      SlidePageNode,
      (mutatedNodes) => {
        if (mutatedNodes.has(nodeKey)) {
          parentEditor.getEditorState().read(() => {
            const n = $getNodeByKey(nodeKey);
            if (SlidePageNode.$isSlidePageNode(n)) {
              setCurrentElements([...n.__elements]);
            } else {
              setCurrentElements([]);
            }
          });
        }
      },
    );
    return () => unregister();
  }, [parentEditor, nodeKey]);

  const onDelete = useCallback(() => {
    if (!parentEditor) return false;
    parentEditor.update(() => {
      const slideNodeInstance = $getNodeByKey(nodeKey);
      if (!SlidePageNode.$isSlidePageNode(slideNodeInstance)) return;

      if (selectedElementId) {
        slideNodeInstance.removeElement(selectedElementId);
        setSelectedElementId(null);
      } else {
        slideNodeInstance.remove();
        // Active key update will be handled by SlideDeckPlugin's refresh logic
      }
    });
    return true;
  }, [parentEditor, nodeKey, selectedElementId, setSelectedElementId]);

  useEffect(() => {
    if (isThisSlideActive && parentEditor) {
      return mergeRegister(
        parentEditor.registerCommand(
          KEY_DELETE_COMMAND,
          onDelete,
          COMMAND_PRIORITY_EDITOR,
        ),
        parentEditor.registerCommand(
          KEY_BACKSPACE_COMMAND,
          onDelete,
          COMMAND_PRIORITY_EDITOR,
        ),
      );
    }
  }, [parentEditor, onDelete, isThisSlideActive]);

  const handleSlideClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (selectedElementId) {
        setSelectedElementId(null);
      }
    },
    [selectedElementId, setSelectedElementId],
  );

  const isSlideItselfSelected = isThisSlideActive && !selectedElementId;

  const shouldRenderContent = useMemo(() => {
    if (activeIndex === -1 || slideIndex === -1) return false; // Not ready or slide not found
    return Math.abs(slideIndex - activeIndex) <= 1 || isThisSlideActive;
  }, [slideIndex, activeIndex, isThisSlideActive]);

  return (
    <SlideScaleWrapper>
      <div
        ref={rootRef}
        className={cn(
          "slide-component-root",
          "relative outline-none size-full bg-background shadow rounded-lg overflow-visible",
          "transition-transform duration-150 ease-in-out border-2 border-transparent",
          isThisSlideActive &&
            !isSlideItselfSelected &&
            "hover:border-primary/40",
          isSlideItselfSelected && "border-primary outline-none",
        )}
        style={{
          pointerEvents: isThisSlideActive ? "auto" : "none", // Interact only with active slide
        }}
        onClick={isThisSlideActive ? handleSlideClick : undefined}
        tabIndex={isThisSlideActive ? -1 : undefined}
      >
        {shouldRenderContent ? (
          <SlideBody slideNodeKey={nodeKey} slideElements={currentElements}>
            {currentElements.map((el) => {
              return (
                <DraggableBox key={el.id} el={el} slideKey={nodeKey}>
                  <NestedTextEditor element={el} slideNodeKey={nodeKey} />
                </DraggableBox>
              );
            })}
          </SlideBody>
        ) : (
          <div className="size-full bg-background opacity-0" />
        )}
      </div>
    </SlideScaleWrapper>
  );
};

interface NestedTextEditorProps {
  element: Extract<SlideElementSpec, { kind: "box" }>;
  slideNodeKey: NodeKey;
}

const NestedTextEditor: React.FC<NestedTextEditorProps> = ({
  element,
  slideNodeKey,
}) => {
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const parentEditor = useSlideParentEditor();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();
  const { historyState } = useSharedHistoryContext();
  const {
    activeKey: globalActiveSlideKey,
    setActiveKey: contextSetActiveKey,
    selectedElementId: contextSelectedElementId,
  } = useActiveSlideKey();
  const isParentSlideActive = globalActiveSlideKey === slideNodeKey;

  const initialEditor = React.useMemo(() => {
    const editor = createEditor({
      namespace: `slide-text-${element.id}`,
      nodes: [
        KeywordNode,
        HashtagNode,
        EmojiNode,
        ParagraphNode,
        TextNode,
        LineBreakNode,
        HeadingNode,
        QuoteNode,
        ImageNode,
        InlineImageNode,
        VideoNode,
        TableNode,
        TableRowNode,
        TableCellNode,
        AutoLinkNode,
        LinkNode,
        ListItemNode,
        ListNode,
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
      ],
      onError(error: Error) {
        console.error(
          `[NestedTextEditor ${element.id}] Error in createEditor for nested editor:`,
          error,
        );
        throw error;
      },
      theme: {},
      editable: isParentSlideActive,
    });

    if (element.editorStateJSON) {
      try {
        const state = editor.parseEditorState(element.editorStateJSON);
        if (!state.isEmpty()) editor.setEditorState(state);
      } catch (e) {
        console.warn(
          `Bad stored JSON for element ${element.id} – starting empty`,
          e,
        );
      }
    }

    return editor;
  }, [element, isParentSlideActive]);

  const DRAGGABLE_BOX_VERTICAL_PADDING = 8; // Assuming p-1 class (0.25rem padding) and 1rem = 16px, so 0.25*16*2 = 8px for top+bottom.
  const MIN_TEXT_ELEMENT_HEIGHT = 40; // Minimum overall height for the text element box.

  const persist = useCallback(
    (editorState: EditorState) => {
      if (!isParentSlideActive) return;

      const json = editorState.toJSON();
      let newHeight = element.height;

      if (editorRef.current) {
        const contentEditableScrollHeight = editorRef.current.scrollHeight;

        const calculatedOuterHeight = Math.max(
          MIN_TEXT_ELEMENT_HEIGHT,
          contentEditableScrollHeight + DRAGGABLE_BOX_VERTICAL_PADDING,
        );

        if (calculatedOuterHeight !== element.height) {
          newHeight = calculatedOuterHeight;
        }
      }

      parentEditor.update(() => {
        const node = $getNodeByKey(slideNodeKey);
        if (SlidePageNode.$isSlidePageNode(node)) {
          node.updateElement(element.id, {
            editorStateJSON: JSON.stringify(json),
            height: newHeight,
          });
        }
      });
    },
    [
      parentEditor,
      element.id,
      element.height,
      slideNodeKey,
      isParentSlideActive,
    ],
  );

  const handleFocus = useCallback(() => {
    if (isParentSlideActive) {
      // Check if this element is already selected to avoid redundant updates
      if (contextSelectedElementId !== element.id) {
        contextSetActiveKey(slideNodeKey, element.id);
      }
    }
  }, [
    isParentSlideActive,
    contextSetActiveKey,
    slideNodeKey,
    element.id,
    contextSelectedElementId,
  ]);

  return (
    <LexicalNestedComposer
      initialEditor={initialEditor}
      key={`${slideNodeKey}-${element.id}-${isParentSlideActive}`}
    >
      <div onFocusCapture={handleFocus} className="h-full w-full">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              ref={editorRef}
              className="w-full h-full focus:outline-none outline-none"
            />
          }
          placeholder={
            isParentSlideActive ? (
              <div className="absolute top-1 left-1 text-muted-foreground select-none pointer-events-none">
                Text...
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        {isParentSlideActive && (
          <>
            <OnChangePlugin onChange={persist} />
            <MarkdownShortcutPlugin />
            <HorizontalRulePlugin />
            <EquationsPlugin />
            <HistoryPlugin externalHistoryState={historyState} />
            <AutoFocusPlugin />
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
            <TableActionMenuPlugin />
          </>
        )}
        {showNestedEditorTreeView && <TreeViewPlugin />}
      </div>
    </LexicalNestedComposer>
  );
};

interface DraggableBoxProps {
  el: Extract<SlideElementSpec, { kind: "box" }>;
  slideKey: NodeKey;
  children: React.ReactNode;
}
function DraggableBox({ el, slideKey, children }: DraggableBoxProps) {
  const {
    activeKey: globalActiveSlideKey,
    selectedElementId,
    setActiveKey,
  } = useActiveSlideKey();

  const isParentSlideActive = globalActiveSlideKey === slideKey;
  const isThisBoxSelected = isParentSlideActive && selectedElementId === el.id;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    active: dndKitActiveElement,
  } = useDraggable({
    id: el.id,
    disabled: !isParentSlideActive, // Disable dragging if the parent slide is not active
  });
  const isDragging = Boolean(
    dndKitActiveElement && dndKitActiveElement.id === el.id,
  );

  const style: React.CSSProperties = {
    position: "absolute",
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
    boxSizing: "border-box",
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    // Cursor indicates non-interactivity if parent slide is not active
    cursor: !isParentSlideActive
      ? "default"
      : isDragging
        ? "grabbing"
        : isThisBoxSelected
          ? "move"
          : "grab",
    zIndex: isThisBoxSelected || isDragging ? 20 : 10,
  };

  return (
    <div
      ref={setNodeRef}
      {...(isParentSlideActive ? attributes : {})}
      {...(isParentSlideActive ? listeners : {})}
      style={style}
      className={cn(
        "group slide-element-draggable",
        "p-1", // Padding to create the "border" area for the grab/move cursor
      )}
      onClick={
        isParentSlideActive
          ? (e) => {
              e.stopPropagation();
              if (!isThisBoxSelected) {
                // Parent slide is active, but this box isn't selected yet. Select it.
                // setActiveKey will be called with slideKey, which is globalActiveSlideKey here,
                // so this action will not change the active slide, only the selected element.
                setActiveKey(slideKey, el.id);
              }
            }
          : (e) => {
              // If parent slide is not active, a click here should ideally not happen.
              // If it does, stop propagation and do nothing to prevent unintended slide changes.
              e.stopPropagation();
            }
      }
    >
      {/* CONTENT — is always editable */}
      <div data-uid={el.id} className="relative size-full">
        {children}
      </div>
      {/* VISUAL HALO (รอบๆ) */}
      <div
        className={cn(
          "absolute inset-0 rounded pointer-events-none transition-all duration-100",
          isThisBoxSelected // Halo only if selected (which implies parent is active)
            ? "ring-2 ring-primary/90 opacity-100"
            : "opacity-0 group-hover:opacity-100 group-hover:ring-2 group-hover:ring-primary/40",
          !isParentSlideActive && "hidden", // Explicitly hide halo if parent slide not active
        )}
      />
      {/* RESIZE HANDLES */}
      {isThisBoxSelected &&
        (["nw", "ne", "sw", "se"] as const).map((k) => (
          <CornerHandle key={k} corner={k} el={el} slideKey={slideKey} />
        ))}
    </div>
  );
}

interface CornerHandleProps {
  corner: "nw" | "ne" | "sw" | "se";
  el: Extract<SlideElementSpec, { kind: "box" }>;
  slideKey: NodeKey;
}
function CornerHandle({ corner, el, slideKey }: CornerHandleProps) {
  const editor = useSlideParentEditor();
  const posStyles: Record<typeof corner, string> = {
    nw: "left-0 top-0 cursor-nwse-resize",
    ne: "right-0 top-0 cursor-nesw-resize",
    sw: "left-0 bottom-0 cursor-nesw-resize",
    se: "right-0 bottom-0 cursor-nwse-resize",
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const { x: initialX, y: initialY, width: initialW, height: initialH } = el;

    const move = (ev: PointerEvent) => {
      ev.stopPropagation();
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let newX = initialX,
        newY = initialY,
        newW = initialW,
        newH = initialH;
      const minW = 40,
        minH = 20;

      if (corner.includes("w")) {
        newW = Math.max(minW, initialW - dx);
        newX = initialX + (initialW - newW);
      } else if (corner.includes("e")) {
        newW = Math.max(minW, initialW + dx);
      }
      if (corner.includes("n")) {
        newH = Math.max(minH, initialH - dy);
        newY = initialY + (initialH - newH);
      } else if (corner.includes("s")) {
        newH = Math.max(minH, initialH + dy);
      }

      editor.update(() => {
        const node = $getNodeByKey(slideKey);
        if (SlidePageNode.$isSlidePageNode(node)) {
          node.updateElement(el.id, {
            x: newX,
            y: newY,
            width: newW,
            height: newH,
          });
        }
      });
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
        "absolute w-3 h-3 bg-transparent rounded-full -m-1.5 z-30",
        posStyles[corner],
      )}
    />
  );
}

interface SlideBodyProps {
  children: React.ReactNode;
  slideNodeKey: NodeKey;
  slideElements: SlideElementSpec[];
}
function SlideBody({ children, slideNodeKey }: SlideBodyProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
  );
  const editor = useSlideParentEditor();

  const onDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    if (!active || (!delta.x && !delta.y)) return; // No movement or no active element
    const id = active.id as string;

    editor.update(() => {
      const slide = $getNodeByKey(slideNodeKey);
      if (SlidePageNode.$isSlidePageNode(slide)) {
        const currentElement = slide.__elements.find((item) => item.id === id);
        if (currentElement) {
          slide.updateElement(id, {
            x: (currentElement.x || 0) + delta.x,
            y: (currentElement.y || 0) + delta.y,
          });
        }
      }
    });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}
