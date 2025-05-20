import React, { useCallback, useEffect, useState } from "react";
import {
  $getNodeByKey,
  LexicalEditor,
  NodeKey,
  type EditorState,
  ParagraphNode,
  TextNode,
  LineBreakNode,
  createEditor,
} from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { KeywordNode } from "../KeywordNode";
import { HashtagNode } from "@lexical/hashtag";
import { EmojiNode } from "../EmojiNode";
import { ImageNode } from "../ImageNode/ImageNode";
import { InlineImageNode } from "../InlineImageNode/InlineImageNode";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
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
import {
  SlideContainerNode,
  useSlideParentEditor,
  useActiveSlideKey,
  type SlideElementSpec,
} from "./SlideNode";
import { Button } from "~/components/ui/button";
import {
  DndContext,
  useDraggable,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

interface SlideComponentProps {
  nodeKey: NodeKey;
  editor: LexicalEditor;
}

export const SlideComponent: React.FC<SlideComponentProps> = ({
  nodeKey,
  editor,
}) => {
  const { activeKey, setActiveKey, slideKeys } = useActiveSlideKey();
  const [, force] = useState(0);

  useEffect(
    () =>
      editor.registerMutationListener(SlideContainerNode, (mutatedNodes) => {
        if ([...mutatedNodes.keys()].includes(nodeKey)) {
          force((c) => c + 1);
        }
      }),
    [editor, nodeKey],
  );

  const slideNode = editor.getEditorState().read(() => {
    const n = $getNodeByKey(nodeKey);
    return SlideContainerNode.$isSlideContainerNode(n) ? n : null;
  });
  if (!slideNode) return null;

  return (
    <SlideBody>
      {activeKey !== null && slideKeys.length > 0 && (
        <Controls
          editor={editor}
          slideKeys={slideKeys}
          activeKey={activeKey}
          setActiveKey={setActiveKey}
        />
      )}
      {slideNode.__elements.map((el) => {
        if (el.kind === "text") {
          return (
            <DraggableBox key={el.id} el={el} slideKey={nodeKey}>
              <NestedTextEditor element={el} slideNodeKey={nodeKey} />
            </DraggableBox>
          );
        }
        if (el.kind === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={el.id}
              src={el.src}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
              }}
              alt="slide visual"
              draggable={false}
            />
          );
        }
        return null;
      })}
    </SlideBody>
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
  const parentEditor = useSlideParentEditor();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();
  const { historyState } = useSharedHistoryContext();
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
        TableNode,
        TableRowNode,
        TableCellNode,
        AutoLinkNode,
        LinkNode,
        ListItemNode,
        ListNode,
      ],
      onError(error: Error) {
        console.error(
          `[NestedTextEditor ${element.id}] Error in createEditor for nested editor:`,
          error,
        );
        throw error;
      },
      theme: {},
    });

    if (element.editorStateJSON) {
      try {
        const state = editor.parseEditorState(element.editorStateJSON);
        if (!state.isEmpty()) editor.setEditorState(state);
      } catch (e) {
        console.warn("Bad stored JSON – starting empty", e);
      }
    }

    return editor;
  }, [element.id, element.editorStateJSON]);

  const persist = useCallback(
    (editorState: EditorState) => {
      const json = editorState.toJSON();
      parentEditor.update(() => {
        const node = $getNodeByKey(slideNodeKey);
        if (SlideContainerNode.$isSlideContainerNode(node)) {
          node.updateElement(element.id, {
            editorStateJSON: JSON.stringify(json),
          });
        }
      });
    },
    [parentEditor, element.id, slideNodeKey],
  );

  return (
    <LexicalNestedComposer initialEditor={initialEditor}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable className="w-full h-full p-1 focus:outline-1 focus:outline-primary" />
        }
        placeholder={
          <div className="absolute top-1 left-1 text-muted-foreground select-none pointer-events-none">
            Text...
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={persist} />
      <HistoryPlugin externalHistoryState={historyState} />
      <AutoFocusPlugin />
      <MentionsPlugin />
      <LinkPlugin />
      <EmojisPlugin />
      <HashtagPlugin />
      <KeywordsPlugin />

      {showNestedEditorTreeView && <TreeViewPlugin />}

      {/*  */}
    </LexicalNestedComposer>
  );
};

const Controls: React.FC<{
  editor: LexicalEditor;
  slideKeys: NodeKey[];
  activeKey: NodeKey | null;
  setActiveKey: (k: NodeKey) => void;
}> = ({ editor, slideKeys, activeKey, setActiveKey }) => {
  const prev = () => {
    if (!slideKeys.length) return;
    const idx = slideKeys.indexOf(activeKey ?? (slideKeys[0] as string));
    const nextIdx = (idx - 1 + slideKeys.length) % slideKeys.length;
    setActiveKey(slideKeys[nextIdx] as string);
  };
  const next = () => {
    if (!slideKeys.length) return;
    const idx = slideKeys.indexOf(activeKey ?? (slideKeys[0] as string));
    const nextIdx = (idx + 1) % slideKeys.length;
    setActiveKey(slideKeys[nextIdx] as string);
  };
  const createUID = (): string => {
    return Math.random()
      .toString(36)
      .replace(/[^a-z]+/g, "")
      .substring(0, 5);
  };
  const addTextBox = () => {
    if (!activeKey) return;
    editor.update(() => {
      const node = $getNodeByKey(activeKey);
      if (SlideContainerNode.$isSlideContainerNode(node)) {
        console.log("adding text box");
        node.addElement({
          kind: "text",
          id: createUID(),
          x: 100,
          y: 100,
          width: 400,
          height: 120,
          editorStateJSON: null,
        });
      }
    });
  };

  return (
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 flex gap-2 p-2 bg-muted rounded-md mb-2 shadow">
      <Button
        className="bg-muted"
        type="button"
        onClick={prev}
        variant="outline"
      >
        Prev Slide
      </Button>
      <Button
        className="bg-muted"
        type="button"
        onClick={next}
        variant="outline"
      >
        Next Slide
      </Button>
      <Button type="button" onClick={addTextBox} variant="default">
        Add Text Box
      </Button>
    </div>
  );
};

function DraggableBox({
  el,
  slideKey,
  children,
}: {
  el: Extract<SlideElementSpec, { kind: "text" }>;
  slideKey: NodeKey;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: el.id,
  });

  // translate from dnd-kit
  const style = {
    width: el.width,
    height: el.height,
    transform: transform
      ? `translate(${el.x + transform.x}px, ${el.y + transform.y}px)`
      : `translate(${el.x}px, ${el.y}px)`,
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={style}
      className="absolute border border-transparent hover:border-primary cursor-move"
    >
      {children}
      {(["nw", "ne", "sw", "se"] as const).map((c) => (
        <CornerHandle key={c} corner={c} el={el} slideKey={slideKey} />
      ))}
    </div>
  );
}

function CornerHandle({
  corner,
  el,
  slideKey,
}: {
  corner: "nw" | "ne" | "sw" | "se";
  el: Extract<SlideElementSpec, { kind: "text" }>;
  slideKey: NodeKey;
}) {
  const editor = useSlideParentEditor();

  /* position + cursor type */
  const pos: Record<typeof corner, string> = {
    nw: "left-0 top-0 cursor-nwse-resize",
    ne: "right-0 top-0 cursor-nesw-resize",
    sw: "left-0 bottom-0 cursor-nesw-resize",
    se: "right-0 bottom-0 cursor-nwse-resize",
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // prevents drag start
    const startX = e.clientX;
    const startY = e.clientY;
    const { x: startLeft, y: startTop, width: startW, height: startH } = el;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      let nx = startLeft;
      let ny = startTop;
      let nw = startW;
      let nh = startH;

      if (corner.includes("w")) {
        nw = Math.max(40, startW - dx);
        nx = startLeft + dx;
      } else if (corner.includes("e")) {
        nw = Math.max(40, startW + dx);
      }
      if (corner.includes("n")) {
        nh = Math.max(20, startH - dy);
        ny = startTop + dy;
      } else if (corner.includes("s")) {
        nh = Math.max(20, startH + dy);
      }

      editor.update(() => {
        const n = $getNodeByKey(slideKey);
        if (SlideContainerNode.$isSlideContainerNode(n)) {
          n.updateElement(el.id, { x: nx, y: ny, width: nw, height: nh });
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
      className={`absolute w-3 h-3 bg-transparent ${pos[corner]} z-10`}
    />
  );
}

function SlideBody({ children }: { children: React.ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 2 } }),
  );
  const editor = useSlideParentEditor();
  const { activeKey } = useActiveSlideKey();

  const onDragEnd = (e: DragEndEvent) => {
    if (!activeKey) return;
    const id = e.active.id as string;
    const { delta } = e;
    editor.update(() => {
      const slide = $getNodeByKey(activeKey);
      if (SlideContainerNode.$isSlideContainerNode(slide)) {
        const it = slide.__elements.find(
          (x) => x.id === id && x.kind === "text",
        );
        if (it)
          slide.updateElement(id, { x: it.x + delta.x, y: it.y + delta.y });
      }
    });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      {children}
    </DndContext>
  );
}
