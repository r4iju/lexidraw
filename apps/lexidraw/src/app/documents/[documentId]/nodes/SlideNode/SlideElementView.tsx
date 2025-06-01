import React, { useMemo } from "react";
import { LexicalEditor, createEditor } from "lexical";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { type SlideElementSpec } from "./SlideNode";
import { theme as editorTheme } from "../../themes/theme";
import { NESTED_EDITOR_NODES } from "./SlideDeckEditor";
import DynamicChartRenderer from "../ChartNode/DynamicChartRenderer";
import type { ChartConfig } from "~/components/ui/chart";

interface SlideElementViewProps {
  element: SlideElementSpec;
  parentEditor: LexicalEditor;
}

const SlideElementView: React.FC<SlideElementViewProps> = ({
  element,
  parentEditor,
}) => {
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
    const initialEditorState = editor.parseEditorState(element.editorStateJSON);
    editor.setEditorState(initialEditorState);
    return editor;
  }, [element, parentEditor]); // Updated dependencies to use the whole element

  const elementStyle: React.CSSProperties = {
    position: "absolute",
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    backgroundColor:
      "backgroundColor" in element
        ? element.backgroundColor || "transparent"
        : "transparent",
    border:
      "borderColor" in element && element.borderColor
        ? `1px solid ${element.borderColor}`
        : "none", // Assuming borderColor is only for boxes for now
    overflow: "hidden",
    boxSizing: "border-box",
    zIndex: element.zIndex,
  };

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
