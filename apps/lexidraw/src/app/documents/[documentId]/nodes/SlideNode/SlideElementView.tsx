import React, { useMemo } from "react";
import { LexicalEditor, createEditor } from "lexical";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { SlideElementSpec } from "./SlideNode";
import { theme as editorTheme } from "../../themes/theme";
import { NESTED_EDITOR_NODES } from "./SlideDeckEditor";

interface SlideElementViewProps {
  element: SlideElementSpec;
  parentEditor: LexicalEditor;
}

const SlideElementView: React.FC<SlideElementViewProps> = ({
  element,
  parentEditor,
}) => {
  const viewEditor = useMemo(() => {
    const editor = createEditor({
      parentEditor: parentEditor,
      nodes: NESTED_EDITOR_NODES,
      theme: editorTheme,
      editable: false,
      namespace: `slide-element-view-${element.id}`,
      onError: (error: Error) =>
        console.error(
          `Error in read-only nested editor for element ${element.id}:`,
          error,
        ),
    });
    try {
      const initialEditorState = editor.parseEditorState(
        element.editorStateJSON ||
          '{"root":{"children":[{"type":"paragraph","version":1,"children":[]}],"direction":null,"format":"","indent":0,"type":"root","version":1}}',
      );
      editor.setEditorState(initialEditorState);
    } catch (e) {
      console.error(
        `Failed to parse state for read-only element ${element.id}:`,
        e,
      );
      const emptyState = editor.parseEditorState(
        '{"root":{"children":[{"type":"paragraph","version":1,"children":[]}],"direction":null,"format":"","indent":0,"type":"root","version":1}}',
      );
      editor.setEditorState(emptyState);
    }
    return editor;
  }, [element.id, element.editorStateJSON, parentEditor]);

  if (element.kind !== "box" || !element.editorStateJSON) {
    return null;
  }

  const elementStyle: React.CSSProperties = {
    position: "absolute",
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    backgroundColor: "transparent",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  return (
    <div style={elementStyle} data-element-id={element.id}>
      <LexicalNestedComposer
        key={element.id}
        initialEditor={viewEditor}
        initialNodes={NESTED_EDITOR_NODES}
        initialTheme={editorTheme}
        skipCollabChecks={true}
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="p-1 h-full w-full outline-none select-none caret-transparent"
              style={{
                fontSize: "10px",
              }}
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </LexicalNestedComposer>
    </div>
  );
};

export default SlideElementView;
