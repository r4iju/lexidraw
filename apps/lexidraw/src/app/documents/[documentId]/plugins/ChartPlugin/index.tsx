"use client";

import type { JSX } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  COMMAND_PRIORITY_EDITOR,
  PASTE_COMMAND,
  LexicalCommand,
  createCommand,
} from "lexical";
import { useEffect } from "react";
import { ChartNode, ChartType } from "../../nodes/ChartNode";

export const INSERT_CHART_COMMAND: LexicalCommand<{
  type?: ChartType;
  data?: string;
  config?: string;
  width?: number | "inherit";
  height?: number | "inherit";
}> = createCommand("INSERT_CHART_COMMAND");

export default function ChartPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([ChartNode])) {
      throw new Error("ChartPlugin: ChartNode not registered on editor");
    }

    return mergeRegister(
      editor.registerCommand(
        INSERT_CHART_COMMAND,
        (payload) => {
          const chartNode = ChartNode.$createChartNode(
            payload.type,
            payload.data,
            payload.config,
            payload.width,
            payload.height,
          );
          editor.focus();
          editor.update(() => {
            const selection = editor
              .getEditorState()
              .read(() => editor.getEditorState()._selection);
            if (selection) {
              selection.insertNodes([chartNode]);
            }
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // basic paste handling for JSON (very simplistic, might need refinement)
      // this is just an example and might not be robust enough for production
      editor.registerCommand(
        PASTE_COMMAND,
        (event: ClipboardEvent) => {
          const text = event.clipboardData?.getData("text/plain");
          if (text) {
            try {
              const jsonData = JSON.parse(text);
              // attempt to heuristically determine if it's chart data
              if (
                jsonData &&
                typeof jsonData === "object" &&
                ((Array.isArray(jsonData) &&
                  jsonData.length > 0 &&
                  jsonData[0].name &&
                  jsonData[0].value) || // bar/line like
                  (jsonData.chartType && jsonData.chartData)) // our own serialized format (less likely from paste)
              ) {
                // basic heuristic: if it's an array of objects with name/value, assume bar chart data
                // or if it has our specific keys.
                // this is a very naive check.
                let chartType: ChartType = "bar";
                let chartData = text;
                let chartConfig = "{}";

                if (jsonData.chartType && jsonData.chartData) {
                  // more specific check
                  chartType = jsonData.chartType as ChartType;
                  chartData = JSON.stringify(jsonData.chartData);
                  if (jsonData.chartConfig)
                    chartConfig = JSON.stringify(jsonData.chartConfig);
                }

                editor.dispatchCommand(INSERT_CHART_COMMAND, {
                  type: chartType,
                  data: chartData,
                  config: chartConfig,
                });
                event.preventDefault(); // Prevent default paste behavior
                return true;
              }
            } catch (error) {
              // not valid JSON or not chart-like
              console.debug(error);
            }
          }
          return false;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor]);

  return null;
}
