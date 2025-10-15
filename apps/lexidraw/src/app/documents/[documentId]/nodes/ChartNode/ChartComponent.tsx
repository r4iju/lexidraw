"use client";

import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  type BaseSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type NodeKey,
  type LexicalEditor,
  type EditorConfig,
} from "lexical";
import React, {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { ChartNode, type ChartType } from "./index"; // Assuming ChartNode is in the same directory
import ImageResizer from "~/components/ui/image-resizer";
import { Button } from "~/components/ui/button";
import ChartModal from "./ChartModal";
import DynamicChartRenderer from "./DynamicChartRenderer";
import { cn } from "~/lib/utils";
import type { ChartConfig } from "~/components/ui/chart";

type Dimension = number | "inherit";

interface ChartComponentProps {
  nodeKey: NodeKey;
  chartType: ChartType;
  chartData: string; // JSON string
  chartConfig: string; // JSON string
  width: Dimension;
  height: Dimension;
  editor: LexicalEditor;
  config: EditorConfig;
}

export default function ChartComponent({
  nodeKey,
  chartType,
  chartData: chartDataJSON,
  chartConfig: chartConfigJSON,
  width,
  height,
  editor,
}: ChartComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selection, setSelection] = useState<BaseSelection | null>(null);

  const parsedChartData = useMemo(() => {
    try {
      return JSON.parse(chartDataJSON);
    } catch (e) {
      console.error("Failed to parse chartData JSON:", e);
      return [];
    }
  }, [chartDataJSON]);

  const parsedChartConfig = useMemo(() => {
    try {
      return JSON.parse(chartConfigJSON) as ChartConfig;
    } catch (e) {
      console.error("Failed to parse chartConfig JSON:", e);
      return {} as ChartConfig;
    }
  }, [chartConfigJSON]);

  const onDelete = useCallback(
    (e: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        e.preventDefault();
        editor.update(() => {
          const n = $getNodeByKey(nodeKey);
          if (ChartNode.$isChartNode(n)) n.remove();
        });
      }
      return false;
    },
    [editor, isSelected, nodeKey],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (e: MouseEvent) => {
          if (containerRef.current?.contains(e.target as Node)) {
            if (!e.shiftKey) clearSelection();
            setSelected(!isSelected);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, onDelete, isSelected, clearSelection, setSelected]);

  const onResizeEnd = (w: Dimension, h: Dimension) => {
    setTimeout(() => setIsResizing(false), 200);
    editor.update(() => {
      const n = $getNodeByKey(nodeKey) as ChartNode;
      if (ChartNode.$isChartNode(n)) {
        n.setWidthAndHeight({ width: w, height: h });
      }
    });
  };

  const handleSaveChanges = ({
    newChartType,
    newChartData,
    newChartConfig,
    newWidthAndHeight,
  }: {
    newChartType: ChartType;
    newChartData: string; // JSON string
    newChartConfig: string; // JSON string
    newWidthAndHeight: { width: Dimension; height: Dimension };
  }) => {
    editor.update(() => {
      const n = $getNodeByKey(nodeKey) as ChartNode;
      if (ChartNode.$isChartNode(n)) {
        n.setChartType(newChartType);
        n.setChartData(newChartData);
        n.setChartConfig(newChartConfig);
        n.setWidthAndHeight(newWidthAndHeight);
      }
    });
    setModalOpen(false);
  };

  const onDimensionsChangeDuringResize = ({
    width: newWidth,
    height: newHeight,
  }: {
    width: Dimension;
    height: Dimension;
  }) => {
    editor.update(() => {
      const n = $getNodeByKey(nodeKey) as ChartNode;
      if (ChartNode.$isChartNode(n)) {
        n.setWidthAndHeight({ width: newWidth, height: newHeight });
      }
    });
  };

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      setSelection(editorState.read(() => $getSelection()));
    });
  }, [editor]);

  return (
    <>
      <div
        className={cn("relative inline-block chart-component", {
          "cursor-move":
            isSelected && !isResizing && $isNodeSelection(selection),
          "ring-1 ring-muted-foreground": isSelected || isResizing,
        })}
        ref={containerRef}
        draggable={isSelected && !isResizing && $isNodeSelection(selection)}
        style={{
          width: typeof width === "number" ? `${width}px` : "auto",
          height: typeof height === "number" ? `${height}px` : "auto",
        }}
      >
        <DynamicChartRenderer
          chartType={chartType}
          data={parsedChartData}
          config={parsedChartConfig}
          width={width}
          height={height}
        />

        <Button
          ref={btnRef}
          variant="ghost"
          className="absolute top-0 right-0 mt-1 mr-1 z-10 bg-muted/60 hover:bg-muted/80 backdrop-blur-xs cursor-pointer"
          onClick={() => setModalOpen(true)}
        >
          Edit
        </Button>

        {(isSelected || isResizing) && (
          <ImageResizer // Re-using ImageResizer, might need adjustments for charts
            editor={editor}
            imageRef={containerRef as RefObject<HTMLDivElement>}
            buttonRef={btnRef as RefObject<HTMLButtonElement>}
            onResizeStart={() => setIsResizing(true)}
            onResizeEnd={onResizeEnd}
            onDimensionsChange={onDimensionsChangeDuringResize}
            captionsEnabled={false}
            showCaption={false}
            setShowCaption={() => null}
          />
        )}
      </div>

      {modalOpen && (
        <ChartModal
          isOpen
          initialChartType={chartType}
          initialChartData={chartDataJSON}
          initialChartConfig={chartConfigJSON}
          initialWidth={width}
          initialHeight={height}
          onCancel={() => setModalOpen(false)}
          onSave={handleSaveChanges}
        />
      )}
    </>
  );
}
