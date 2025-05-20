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
import { ImageNode } from "../ImageNode/ImageNode";
import { InlineImageNode } from "../InlineImageNode/InlineImageNode";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
  SlideContainerNode,
  useSlideParentEditor,
  useActiveSlideKey,
  type SlideElementSpec,
} from "./SlideNode";
import { Button } from "~/components/ui/button";

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
    const node = $getNodeByKey(nodeKey);
    return SlideContainerNode.$isSlideContainerNode(node) ? node : null;
  });

  if (!slideNode) return null;

  const handleClick = () => {
    if (activeKey !== nodeKey) {
      setActiveKey(nodeKey);
    }
  };

  return (
    <div
      className="absolute inset-0 bg-background"
      style={{ display: nodeKey === activeKey ? "block" : "none" }}
      onClick={handleClick}
    >
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
            <div
              key={el.id}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
              }}
              className="outline-1 outline-transparent hover:outline-primary"
            >
              <NestedTextEditor element={el} slideNodeKey={nodeKey} />
            </div>
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
  const parentEditor = useSlideParentEditor();

  const initialEditor = React.useMemo(() => {
    const editor = createEditor({
      namespace: `slide-text-${element.id}`,
      nodes: [
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
          <ContentEditable className="w-full h-full p-1 outline-none" />
        }
        placeholder={
          <div className="absolute top-1 left-1 text-muted-foreground select-none pointer-events-none">
            Text...
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={persist} />
      <HistoryPlugin />
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
