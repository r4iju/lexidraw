import React, { useMemo } from "react";
import { LexicalEditor, createEditor } from "lexical";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { type SlideElementSpec } from "./SlideNode";
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
          `[SlideElementView] Error in read-only nested editor for element ${element.id}:`,
          error,
        ),
    });
    try {
      const initialEditorState = editor.parseEditorState(
        element.editorStateJSON || "",
      );
      editor.setEditorState(initialEditorState);
    } catch (e) {
      console.error(
        `[SlideElementView] Failed to parse state for read-only element ${element.id}:`,
        e,
      );
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
        key={`${element.id}-${element.version}`}
        initialEditor={viewEditor}
        initialNodes={NESTED_EDITOR_NODES}
        initialTheme={editorTheme}
        skipCollabChecks={true}
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="p-1 h-full w-full outline-none select-none caret-transparent pointer-events-none" />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </LexicalNestedComposer>
    </div>
  );
};

export default SlideElementView;
