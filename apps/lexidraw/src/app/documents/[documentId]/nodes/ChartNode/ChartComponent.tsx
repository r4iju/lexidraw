"use client";

import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
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
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import { ChartNode, type ChartType } from "./index"; // Assuming ChartNode is in the same directory
import ImageResizer from "~/components/ui/image-resizer";
import { NodeEditButton } from "../common/NodeEditButton";
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
  const isEditable = useLexicalEditable();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const isFocused = isEditable && isSelected;
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
        className={cn(
          "group/node relative block max-w-full mx-auto chart-component",
          {
            "cursor-move":
              isFocused && !isResizing && $isNodeSelection(selection),
            "ring-1 ring-muted-foreground": isFocused || isResizing,
          },
        )}
        data-empty={parsedChartData.length === 0}
        ref={containerRef}
        draggable={isFocused && !isResizing && $isNodeSelection(selection)}
        style={{
          width: typeof width === "number" ? width : "100%",
          aspectRatio:
            parsedChartData.length === 0
              ? undefined
              : typeof width === "number" && typeof height === "number"
                ? `${width} / ${height}`
                : "2 / 1",
        }}
      >
        <DynamicChartRenderer
          chartType={chartType}
          data={parsedChartData}
          config={parsedChartConfig}
          width={width}
          height={height}
        />

        {isEditable && (
          <NodeEditButton
            ref={btnRef}
            label="Edit chart"
            visible={isFocused}
            onClick={() => setModalOpen(true)}
          />
        )}

        {(isFocused || isResizing) && (
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
