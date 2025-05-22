import React, { useCallback, useEffect, useState, useMemo } from "react";
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
// ... other imports remain the same
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { LayoutContainerNode } from "../../nodes/LayoutContainerNode";
import { LayoutItemNode } from "../../nodes/LayoutItemNode";
import { KeywordNode } from "../KeywordNode";
import { HashtagNode } from "@lexical/hashtag";
import { EmojiNode } from "../EmojiNode";
import { ImageNode } from "../ImageNode/ImageNode";
import { InlineImageNode } from "../InlineImageNode/InlineImageNode";
import { VideoNode } from "../VideoNode/VideoNode";
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
import { TweetNode } from "../../nodes/TweetNode";
import { YouTubeNode } from "../../nodes/YouTubeNode";
import ExcalidrawPlugin from "../../plugins/ExcalidrawPlugin";
import { ExcalidrawNode } from "../../nodes/ExcalidrawNode";
import { FigmaNode } from "../../nodes/FigmaNode";
import { EquationNode } from "../../nodes/EquationNode";
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
import { INSERT_PAGE_COMMAND } from "../../plugins/SlidePlugin";
import { useActiveSlideKey, useSlideParentEditor } from "./slide-context";
import { Button } from "~/components/ui/button";
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
  } = useActiveSlideKey();

  const slideIndex = useMemo(
    () => slideKeys.indexOf(nodeKey),
    [slideKeys, nodeKey],
  );
  const activeIndex = useMemo(
    () => (activeKey ? slideKeys.indexOf(activeKey) : -1),
    [slideKeys, activeKey],
  );

  const isThisSlideActive = activeIndex !== -1 && activeIndex === slideIndex;

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

  let translateXPercentage = 0;
  if (activeIndex !== -1 && slideIndex !== -1) {
    translateXPercentage = (slideIndex - activeIndex) * 100;
  }

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
        setSelectedElementId(null); // Click on slide background deselects element
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
    <div
      className={cn(
        "slide-component-root",
        "absolute inset-0 outline-none size-full bg-background shadow rounded-lg overflow-visible",
        "transition-transform duration-150 ease-in-out border-2 border-transparent",
        isThisSlideActive &&
          !isSlideItselfSelected &&
          "hover:border-primary/40",
        isSlideItselfSelected && "border-primary outline-none",
      )}
      style={{
        transform: `translateX(${translateXPercentage}%)`,
        pointerEvents: isThisSlideActive ? "auto" : "none", // Interact only with active slide
      }}
      onClick={isThisSlideActive ? handleSlideClick : undefined}
      tabIndex={isThisSlideActive ? -1 : undefined}
    >
      {shouldRenderContent ? (
        <SlideBody slideNodeKey={nodeKey} slideElements={currentElements}>
          {isThisSlideActive && <Controls />}
          {currentElements.map((el) => {
            if (el.kind === "text") {
              return (
                <DraggableBox key={el.id} el={el} slideKey={nodeKey}>
                  <NestedTextEditor element={el} slideNodeKey={nodeKey} />
                </DraggableBox>
              );
            }
            if (el.kind === "image") {
              const isImageSelected =
                isThisSlideActive && selectedElementId === el.id;
              return (
                <div
                  key={el.id}
                  className={cn(
                    "slide-element-image absolute",
                    isImageSelected && "ring-2 ring-primary",
                  )}
                  style={{
                    left: el.x,
                    top: el.y,
                    width: el.width,
                    height: el.height,
                    cursor: isThisSlideActive ? "pointer" : "default",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Only allow selecting the image if this slide is currently active
                    if (isThisSlideActive) {
                      setSelectedElementId(el.id);
                    }
                    // DO NOT call setActiveKey here, to prevent navigation by clicking images
                    // on adjacent, non-active (but visible for transition) slides.
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={el.src}
                    alt="slide visual"
                    draggable={false}
                    className="w-full h-full object-contain"
                  />
                </div>
              );
            }
            return null;
          })}
        </SlideBody>
      ) : (
        <div className="size-full bg-background opacity-0" />
      )}
    </div>
  );
};

interface NestedTextEditorProps {
  element: Extract<SlideElementSpec, { kind: "text" }>;
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

  const persist = useCallback(
    (editorState: EditorState) => {
      if (!isParentSlideActive) return;

      const json = editorState.toJSON();
      parentEditor.update(() => {
        const node = $getNodeByKey(slideNodeKey);
        if (SlidePageNode.$isSlidePageNode(node)) {
          node.updateElement(element.id, {
            editorStateJSON: JSON.stringify(json),
          });
        }
      });
    },
    [parentEditor, element.id, slideNodeKey, isParentSlideActive],
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
              className="w-full h-full p-1 focus:outline-none outline-none"
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
          </>
        )}
        {showNestedEditorTreeView && <TreeViewPlugin />}
      </div>
    </LexicalNestedComposer>
  );
};

// NestedTextEditor, Controls, DraggableBox, CornerHandle, SlideBody remain largely the same
// Ensure Controls uses useActiveSlideKey to get slideKeys for disabling prev/next buttons.

// Minor update to Controls to ensure deckEditor is available for dispatchCommand
const Controls: React.FC = () => {
  const {
    activeKey,
    setActiveKey,
    slideKeys, // Added for disabling buttons
    deckEditor,
    setSelectedElementId,
  } = useActiveSlideKey();

  const navigate = (direction: "prev" | "next") => {
    if (!deckEditor || !activeKey || !slideKeys || slideKeys.length <= 1)
      return; // Check slideKeys
    const currentIndex = slideKeys.indexOf(activeKey);
    const newIndex =
      direction === "prev"
        ? (currentIndex - 1 + slideKeys.length) % slideKeys.length
        : (currentIndex + 1) % slideKeys.length;

    const newKey = slideKeys[newIndex];
    if (newKey) {
      setActiveKey(newKey, null);
      // deckEditor.update(() => $getNodeByKey(newKey)?.selectStart()); // Optional: focus node
    }
  };

  const createUID = (): string => Math.random().toString(36).substring(2, 9);

  const addTextBox = () => {
    if (!deckEditor || !activeKey) return;
    deckEditor.update(() => {
      const node = $getNodeByKey(activeKey);
      if (SlidePageNode.$isSlidePageNode(node)) {
        const newId = createUID();
        node.addElement({
          kind: "text",
          id: newId,
          x: 100,
          y: 100,
          width: 300,
          height: 100,
          editorStateJSON: null,
        });
        setSelectedElementId(newId);
      }
    });
  };

  return (
    <div className="slide-controls absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex gap-2 p-2 bg-background/80 backdrop-blur-sm border border-border rounded-md shadow-lg">
      <Button
        type="button"
        onClick={() => navigate("prev")}
        variant="outline"
        disabled={!slideKeys || slideKeys.length <= 1}
      >
        Prev
      </Button>
      <Button
        type="button"
        onClick={() => navigate("next")}
        variant="outline"
        disabled={!slideKeys || slideKeys.length <= 1}
      >
        Next
      </Button>
      <Button type="button" onClick={addTextBox} variant="default">
        Add Text
      </Button>
      <Button
        variant="default"
        onClick={() => {
          if (deckEditor) {
            // Ensure deckEditor exists
            deckEditor.dispatchCommand(INSERT_PAGE_COMMAND, undefined);
          }
        }}
      >
        Add Slide
      </Button>
    </div>
  );
};

interface DraggableBoxProps {
  el: Extract<SlideElementSpec, { kind: "text" }>;
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
        "group slide-element-draggable", // Class for potential targeting by handleClickOutside
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
      <div data-uid={el.id} className="relative w-full h-full bg-background">
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
  el: Extract<SlideElementSpec, { kind: "text" | "image" }>; // Generalize for other elements if needed
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
    <DndContext
      sensors={sensors}
      onDragEnd={onDragEnd} /* collisionDetection={closestCenter} */
    >
      {" "}
      {children}
    </DndContext>
  );
}
