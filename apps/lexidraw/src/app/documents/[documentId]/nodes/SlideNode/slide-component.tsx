import React, {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
} from "react";
import {
  $getNodeByKey,
  NodeKey,
  type EditorState,
  KEY_DELETE_COMMAND,
  KEY_BACKSPACE_COMMAND,
  COMMAND_PRIORITY_EDITOR,
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
import { useActiveSlideKey, useSlideModal } from "./slide-context";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { SlideControls } from "./slide-controls";
import { INSERT_PAGE_COMMAND } from "../../plugins/SlidePlugin";

interface SlideComponentProps {
  nodeKey: NodeKey;
  editor: LexicalEditor;
}

const SlideModal: React.FC<{
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  initialElements: SlideElementSpec[];
  onSave: (newElements: SlideElementSpec[]) => void;
  slideNodeKey: NodeKey;
  slideIndex: number;
  editor: LexicalEditor;
  onAddSlide?: () => void;
}> = ({
  isOpen,
  onOpenChange,
  initialElements,
  onSave,
  slideNodeKey,
  slideIndex,
  editor,
  onAddSlide,
}) => {
  const [modalElements, setModalElements] = useState(initialElements);
  const [modalSelectedElementId, setModalSelectedElementId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (isOpen) {
      setModalElements(initialElements);
      setModalSelectedElementId(null);
    }
  }, [isOpen, initialElements]);

  const handleElementUpdateInModal = (
    elementId: string,
    updates: Partial<SlideElementSpec>,
  ) => {
    setModalElements((prevElements) =>
      prevElements.map((el) =>
        el.id === elementId ? { ...el, ...updates } : el,
      ),
    );
  };

  const handleSave = () => {
    onSave(modalElements);
    onOpenChange(false);
  };

  const handleAddSlideClick = () => {
    if (onAddSlide) {
      onAddSlide();
    }
  };

  const addTextBoxToModalState = (newElement: SlideElementSpec) => {
    setModalElements((prevElements) => [...prevElements, newElement]);
    setModalSelectedElementId(newElement.id);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col justify-center items-center max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden">
        <DialogTitle>Editing Slide {slideIndex + 1}</DialogTitle>
        <div className="w-[1280px] h-[720px] bg-background relative">
          <SlideBody
            slideNodeKey={slideNodeKey}
            slideElements={modalElements}
            editor={editor}
            isModalContext={true}
            setModalElements={setModalElements}
          >
            {modalElements.map((el) => {
              if (el.kind === "box") {
                return (
                  <DraggableBox
                    key={el.id}
                    el={el}
                    slideKey={slideNodeKey}
                    editor={editor}
                    isModalContext={true}
                    modalSelectedElementId={modalSelectedElementId}
                    onModalElementSelect={setModalSelectedElementId}
                    onModalElementUpdate={handleElementUpdateInModal}
                  >
                    <NestedTextEditor
                      element={el}
                      slideNodeKey={slideNodeKey}
                      editor={editor}
                      isModalContext={true}
                      onModalChange={(updates) =>
                        handleElementUpdateInModal(el.id, updates)
                      }
                    />
                  </DraggableBox>
                );
              }
              return null;
            })}
          </SlideBody>
        </div>
        <SlideControls
          isModalContext={true}
          onAddTextBoxInModal={addTextBoxToModalState}
          onAddSlideInModal={onAddSlide ? handleAddSlideClick : undefined}
        />
        <DialogFooter className="w-full justify-between">
          <div>{/* Modal-specific controls could go here */}</div>
          <div>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSave} className="ml-2">
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const SlideComponent: React.FC<SlideComponentProps> = ({
  nodeKey,
  editor,
}) => {
  const {
    activeKey,
    setActiveKey,
    visibleKey,
    slideKeys,
    selectedElementId,
    setSelectedElementId,
    setDeckElement,
  } = useActiveSlideKey();
  const { isModalOpen, setIsModalOpen } = useSlideModal();
  const rootRef = useRef<HTMLDivElement>(null);

  const [currentElements, setCurrentElements] = useState<SlideElementSpec[]>(
    [],
  );

  const slideIndex = useMemo(
    () => slideKeys.indexOf(nodeKey),
    [slideKeys, nodeKey],
  );
  const visibleIndex = useMemo(
    () => (visibleKey ? slideKeys.indexOf(visibleKey) : -1),
    [slideKeys, visibleKey],
  );

  const isThisSlideActive = activeKey === nodeKey;

  useEffect(() => {
    if (isThisSlideActive) {
      const deck = rootRef.current?.closest(".slide-deck-lexical-node");
      setDeckElement(deck as HTMLElement | null);
    }
  }, [isThisSlideActive, setDeckElement]);

  useEffect(() => {
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      if (SlidePageNode.$isSlidePageNode(node)) {
        setCurrentElements(node.getElements());
      }
    });
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const node = $getNodeByKey(nodeKey);
        if (SlidePageNode.$isSlidePageNode(node)) {
          const newElements = [...node.getElements()];
          setCurrentElements((prevElements) => {
            if (JSON.stringify(prevElements) !== JSON.stringify(newElements)) {
              return newElements;
            }
            return prevElements;
          });
        }
      });
    });
    return unregister;
  }, [editor, nodeKey]);

  const onDelete = useCallback(() => {
    editor.update(() => {
      const slideNodeInstance = $getNodeByKey(nodeKey);
      if (!SlidePageNode.$isSlidePageNode(slideNodeInstance)) return;

      if (selectedElementId) {
        slideNodeInstance.removeElement(selectedElementId);
        setSelectedElementId(null);
      } else {
        slideNodeInstance.remove();
      }
    });
    return true;
  }, [editor, nodeKey, selectedElementId, setSelectedElementId]);

  useEffect(() => {
    if (isThisSlideActive) {
      return mergeRegister(
        editor.registerCommand(
          KEY_DELETE_COMMAND,
          onDelete,
          COMMAND_PRIORITY_EDITOR,
        ),
        editor.registerCommand(
          KEY_BACKSPACE_COMMAND,
          onDelete,
          COMMAND_PRIORITY_EDITOR,
        ),
      );
    }
  }, [editor, onDelete, isThisSlideActive]);

  const handleRootClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      if (isThisSlideActive) {
        if (selectedElementId !== null) {
          setSelectedElementId(null);
        }
      } else {
        setActiveKey(nodeKey, null);
      }
    },
    [
      isThisSlideActive,
      selectedElementId,
      nodeKey,
      setActiveKey,
      setSelectedElementId,
    ],
  );

  const isSlideItselfSelected = isThisSlideActive && !selectedElementId;

  const shouldRenderContent = useMemo(() => {
    if (visibleIndex === -1 || slideIndex === -1) return false;
    return Math.abs(slideIndex - visibleIndex) <= 1;
  }, [slideIndex, visibleIndex]);

  const handleModalSave = (newElements: SlideElementSpec[]) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (SlidePageNode.$isSlidePageNode(node)) {
        node.setElements(newElements);
      }
    });
  };

  const handleAddSlideFromModal = () => {
    if (editor) {
      editor.dispatchCommand(INSERT_PAGE_COMMAND, undefined);
    }
  };

  const shouldOpenModal = isModalOpen && activeKey === nodeKey;

  return (
    <>
      <SlideScaleWrapper>
        <div
          ref={rootRef}
          className={cn(
            "slide-component-root",
            "relative outline-none size-full bg-background shadow rounded-lg overflow-visible",
            "transition-transform duration-150 ease-in-out border-2 border-border",
            isThisSlideActive &&
              !isSlideItselfSelected &&
              "hover:border-primary/40",
            isSlideItselfSelected && "border-primary outline-none",
          )}
          style={{
            pointerEvents:
              isThisSlideActive || activeKey === null ? "auto" : "none",
          }}
          onClick={handleRootClick}
          tabIndex={-1}
        >
          {shouldRenderContent ? (
            <SlideBody
              slideNodeKey={nodeKey}
              slideElements={currentElements}
              editor={editor}
            >
              {currentElements.map((el) => {
                if (el.kind === "box") {
                  return (
                    <DraggableBox
                      key={el.id}
                      el={el}
                      slideKey={nodeKey}
                      editor={editor}
                    >
                      <NestedTextEditor
                        element={el}
                        slideNodeKey={nodeKey}
                        editor={editor}
                      />
                    </DraggableBox>
                  );
                }
                return null;
              })}
            </SlideBody>
          ) : (
            <div className="size-full bg-background opacity-0" />
          )}
        </div>
      </SlideScaleWrapper>

      {shouldOpenModal && (
        <SlideModal
          isOpen={shouldOpenModal}
          onOpenChange={setIsModalOpen}
          initialElements={currentElements}
          onSave={handleModalSave}
          slideNodeKey={nodeKey}
          slideIndex={slideIndex}
          editor={editor}
          onAddSlide={handleAddSlideFromModal}
        />
      )}
    </>
  );
};

interface NestedTextEditorProps {
  element: Extract<SlideElementSpec, { kind: "box" }>;
  slideNodeKey: NodeKey;
  editor: LexicalEditor;
  isModalContext?: boolean;
  onModalChange?: (
    updates: Partial<Extract<SlideElementSpec, { kind: "box" }>>,
  ) => void;
}

const NestedTextEditor: React.FC<NestedTextEditorProps> = ({
  element,
  slideNodeKey,
  editor,
  isModalContext = false,
  onModalChange,
}) => {
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();
  const { historyState } = useSharedHistoryContext();
  const {
    activeKey: globalActiveSlideKey,
    setActiveKey: contextSetActiveKey,
    selectedElementId: contextSelectedElementId,
  } = useActiveSlideKey();

  const isParentSlideGloballyActive = globalActiveSlideKey === slideNodeKey;

  const initialEditor = React.useMemo(() => {
    const nestedLexicalEditor = createEditor({
      namespace: `slide-text-${element.id}${isModalContext ? "-modal" : ""}`,
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
        console.error(`[NestedTextEditor ${element.id}] Error:`, error);
        throw error;
      },
      theme: {},
      editable: isModalContext || isParentSlideGloballyActive,
    });

    if (element.editorStateJSON) {
      try {
        const state = nestedLexicalEditor.parseEditorState(
          element.editorStateJSON,
        );
        if (!state.isEmpty()) nestedLexicalEditor.setEditorState(state);
      } catch (e) {
        console.warn(`Bad JSON for element ${element.id}`, e);
      }
    }
    return nestedLexicalEditor;
  }, [
    element.id,
    element.editorStateJSON,
    isModalContext,
    isParentSlideGloballyActive,
  ]);

  const DRAGGABLE_BOX_VERTICAL_PADDING = 8;
  const MIN_TEXT_ELEMENT_HEIGHT = 40;

  const persist = useCallback(
    (editorState: EditorState) => {
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

      const updates = {
        editorStateJSON: JSON.stringify(json),
        height: newHeight,
      };

      if (isModalContext && onModalChange) {
        onModalChange(updates);
      } else if (!isModalContext && isParentSlideGloballyActive) {
        editor.update(() => {
          const node = $getNodeByKey(slideNodeKey);
          if (SlidePageNode.$isSlidePageNode(node)) {
            node.updateElement(element.id, updates);
          }
        });
      }
    },
    [
      editor,
      element.id,
      element.height,
      slideNodeKey,
      isModalContext,
      onModalChange,
      isParentSlideGloballyActive,
    ],
  );

  const handleFocus = useCallback(() => {
    if (isModalContext) {
      // Modal manages its own focus/selection internally if needed
      // For now, NestedTextEditor focus is enough.
    } else if (isParentSlideGloballyActive) {
      if (contextSelectedElementId !== element.id) {
        contextSetActiveKey(slideNodeKey, element.id);
      }
    }
  }, [
    isModalContext,
    isParentSlideGloballyActive,
    contextSetActiveKey,
    slideNodeKey,
    element.id,
    contextSelectedElementId,
  ]);

  const showPlugins = isModalContext || isParentSlideGloballyActive;

  return (
    <LexicalNestedComposer
      initialEditor={initialEditor}
      key={`${slideNodeKey}-${element.id}-${isModalContext}-${isParentSlideGloballyActive}`}
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
            showPlugins ? (
              <div className="absolute top-1 left-1 text-muted-foreground select-none pointer-events-none">
                Text...
              </div>
            ) : null
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        {showPlugins && (
          <>
            <OnChangePlugin
              onChange={persist}
              ignoreHistoryMergeTagChange
              ignoreSelectionChange
            />
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
  editor: LexicalEditor;
  isModalContext?: boolean;
  modalSelectedElementId?: string | null;
  onModalElementSelect?: (id: string | null) => void;
  onModalElementUpdate?: (
    id: string,
    updates: Partial<SlideElementSpec>,
  ) => void;
}

function DraggableBox({
  el,
  slideKey,
  children,
  editor,
  isModalContext = false,
  modalSelectedElementId,
  onModalElementSelect,
  onModalElementUpdate,
}: DraggableBoxProps) {
  const {
    activeKey: globalActiveSlideKey,
    selectedElementId: globalSelectedElementId,
    setActiveKey: globalSetActiveKey,
  } = useActiveSlideKey();

  const isParentSlideGloballyActive = globalActiveSlideKey === slideKey;

  const isThisBoxSelected = isModalContext
    ? modalSelectedElementId === el.id
    : isParentSlideGloballyActive && globalSelectedElementId === el.id;

  const isDraggable = isModalContext || isParentSlideGloballyActive;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    active: dndKitActiveElement,
  } = useDraggable({
    id: el.id,
    disabled: !isDraggable,
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
    cursor: !isDraggable
      ? "default"
      : isDragging
        ? "grabbing"
        : isThisBoxSelected
          ? "move"
          : "grab",
    zIndex: isThisBoxSelected || isDragging ? 20 : 10,
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isModalContext) {
      if (onModalElementSelect) {
        onModalElementSelect(el.id);
      }
    } else if (isParentSlideGloballyActive) {
      if (!isThisBoxSelected) {
        globalSetActiveKey(slideKey, el.id);
      }
    }
  };

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? attributes : {})}
      {...(isDraggable ? listeners : {})}
      style={style}
      className={cn("group slide-element-draggable", "p-1")}
      onClick={handleClick}
    >
      <div data-uid={el.id} className="relative size-full">
        {children}
      </div>
      <div
        className={cn(
          "absolute inset-0 rounded pointer-events-none transition-all duration-100",
          isThisBoxSelected
            ? "ring-2 ring-primary/90 opacity-100"
            : "opacity-0 group-hover:opacity-100 group-hover:ring-2 group-hover:ring-primary/40",
          !isDraggable && "hidden",
        )}
      />
      {isThisBoxSelected &&
        isDraggable &&
        (["nw", "ne", "sw", "se"] as const).map((k) => (
          <CornerHandle
            key={k}
            corner={k}
            el={el}
            slideKey={slideKey}
            editor={editor}
            isModalContext={isModalContext}
            onModalElementUpdate={onModalElementUpdate}
          />
        ))}
    </div>
  );
}

interface CornerHandleProps {
  corner: "nw" | "ne" | "sw" | "se";
  el: Extract<SlideElementSpec, { kind: "box" }>;
  slideKey: NodeKey;
  editor: LexicalEditor;
  isModalContext?: boolean;
  onModalElementUpdate?: (
    id: string,
    updates: Partial<SlideElementSpec>,
  ) => void;
}

function CornerHandle({
  corner,
  el,
  slideKey,
  editor,
  isModalContext = false,
  onModalElementUpdate,
}: CornerHandleProps) {
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

      const updates = { x: newX, y: newY, width: newW, height: newH };

      if (isModalContext && onModalElementUpdate) {
        onModalElementUpdate(el.id, updates);
      } else if (!isModalContext) {
        editor.update(() => {
          const node = $getNodeByKey(slideKey);
          if (SlidePageNode.$isSlidePageNode(node)) {
            node.updateElement(el.id, updates);
          }
        });
      }
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
  editor: LexicalEditor;
  isModalContext?: boolean;
  setModalElements?: React.Dispatch<React.SetStateAction<SlideElementSpec[]>>;
}

function SlideBody({
  children,
  slideNodeKey,
  slideElements,
  editor,
  isModalContext = false,
  setModalElements,
}: SlideBodyProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, delta } = event;
    if (!active || (!delta.x && !delta.y)) return;
    const id = active.id as string;

    if (isModalContext && setModalElements) {
      setModalElements((prevElements) =>
        prevElements.map((item) => {
          if (item.id === id) {
            const currentX = typeof item.x === "number" ? item.x : 0;
            const currentY = typeof item.y === "number" ? item.y : 0;
            return { ...item, x: currentX + delta.x, y: currentY + delta.y };
          }
          return item;
        }),
      );
    } else if (!isModalContext) {
      editor.update(() => {
        const slide = $getNodeByKey(slideNodeKey);
        if (SlidePageNode.$isSlidePageNode(slide)) {
          const currentElement = slideElements.find((item) => item.id === id);
          if (currentElement) {
            const currentX =
              typeof currentElement.x === "number" ? currentElement.x : 0;
            const currentY =
              typeof currentElement.y === "number" ? currentElement.y : 0;
            slide.updateElement(id, {
              x: currentX + delta.x,
              y: currentY + delta.y,
            });
          }
        }
      });
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}
