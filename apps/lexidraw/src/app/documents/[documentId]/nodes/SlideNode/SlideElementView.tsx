import type React from "react";
import { useMemo } from "react";
import { type LexicalEditor, createEditor } from "lexical";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import type { SlideElementSpec } from "./SlideNode";
import { theme as editorTheme } from "../../themes/theme";
import { NESTED_EDITOR_NODES } from "./SlideDeckEditor";
import DynamicChartRenderer from "../ChartNode/DynamicChartRenderer";
import type { ChartConfig } from "~/components/ui/chart";
import { useLexicalTransformation } from "../../context/editors-context";
import { EMPTY_CONTENT } from "../../initial-content";

interface SlideElementViewProps {
  element: SlideElementSpec;
  parentEditor: LexicalEditor;
}

const SlideElementView: React.FC<SlideElementViewProps> = ({
  element,
  parentEditor,
}) => {
  const { transformToLexicalSourcedJSON } = useLexicalTransformation();
  const viewEditor = useMemo(() => {
    if (element.kind !== "box") {
      return null; // no editor for non-box elements
    }

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
    if (!element.editorStateJSON) {
      throw new Error(
        `[SlideElementView] No editorStateJSON for element ${element.id}`,
      );
    }

    const standardLexicalJSON = transformToLexicalSourcedJSON(
      element.editorStateJSON,
    );

    let initialEditorState = editor.parseEditorState(standardLexicalJSON);

    if (initialEditorState.isEmpty()) {
      console.error(
        `[SlideElementView] CRITICAL: Parsed state for element ${element.id} is empty. Using fallback content.`,
        { originalEditorStateJSON: element.editorStateJSON },
      );
      // Create a valid state synchronously.
      const fallbackState = editor.parseEditorState(EMPTY_CONTENT);
      initialEditorState = fallbackState;
    }

    editor.setEditorState(initialEditorState);

    return editor;
  }, [element, parentEditor, transformToLexicalSourcedJSON]); // Updated dependencies to use the whole element

  const baseStyle: React.CSSProperties = {
    position: "absolute",
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    backgroundColor:
      "backgroundColor" in element
        ? element.backgroundColor || "transparent"
        : "transparent",
    // border styling can be added via CSS classes or updateElementProperties if needed
    overflow: "hidden",
    boxSizing: "border-box",
    zIndex: element.zIndex,
  };

  const elementStyle: React.CSSProperties = baseStyle;

  if (element.kind === "box" && viewEditor) {
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
  }

  if (element.kind === "image") {
    return (
      <div style={elementStyle} data-element-id={element.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={element.url}
          alt={`Slide image ${element.id}`}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          draggable={false} // Prevent native image drag interference
        />
      </div>
    );
  }

  if (element.kind === "chart") {
    // Attempt to parse chartData and chartConfig, with fallbacks for safety
    let chartData: unknown[] = [];
    let chartConfig: ChartConfig = {};
    try {
      chartData = JSON.parse(element.chartData) as unknown[];
    } catch (e) {
      console.error(
        `[SlideElementView] Error parsing chartData for element ${element.id}:`,
        e,
      );
    }
    try {
      chartConfig = JSON.parse(element.chartConfig) as ChartConfig;
    } catch (e) {
      console.error(
        `[SlideElementView] Error parsing chartConfig for element ${element.id}:`,
        e,
      );
    }

    return (
      <div style={elementStyle} data-element-id={element.id}>
        <DynamicChartRenderer
          chartType={element.chartType}
          data={chartData}
          config={chartConfig}
          width={element.width}
          height={element.height}
        />
      </div>
    );
  }

  return null;
};

export default SlideElementView;
