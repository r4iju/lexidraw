import type { TableCellNode, TableDOMCell, TableMapType } from "@lexical/table";
import type { LexicalEditor, NodeKey } from "lexical";
import type { JSX } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import {
  $computeTableMapSkipCellCheck,
  $getTableNodeFromLexicalNodeOrThrow,
  $getTableRowIndexFromTableCellNode,
  $isTableCellNode,
  $isTableRowNode,
  getDOMCellFromTarget,
  getTableElement,
  TableNode,
} from "@lexical/table";
import { calculateZoomLevel, mergeRegister } from "@lexical/utils";
import { $getNearestNodeFromDOMNode, isHTMLElement } from "lexical";
import * as React from "react";
import {
  type CSSProperties,
  type PointerEventHandler,
  type ReactPortal,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "~/lib/utils";

type PointerPosition = {
  x: number;
  y: number;
};

type PointerDraggingDirection = "right" | "bottom";

const MIN_ROW_HEIGHT = 33;
const MIN_COLUMN_WIDTH = 92;

function TableCellResizer({ editor }: { editor: LexicalEditor }): JSX.Element {
  const targetRef = useRef<HTMLElement | null>(null);
  const resizerRef = useRef<HTMLDivElement | null>(null);
  const tableRectRef = useRef<ClientRect | null>(null);
  const [tableRect, setTableRect] = useState<ClientRect | null>(null);
  const [hasTable, setHasTable] = useState(false);

  const pointerStartPosRef = useRef<PointerPosition | null>(null);
  const [pointerCurrentPos, updatePointerCurrentPos] =
    useState<PointerPosition | null>(null);

  const [activeCell, updateActiveCell] = useState<TableDOMCell | null>(null);
  const [draggingDirection, updateDraggingDirection] =
    useState<PointerDraggingDirection | null>(null);

  const resetState = useCallback(() => {
    updateActiveCell(null);
    targetRef.current = null;
    updateDraggingDirection(null);
    pointerStartPosRef.current = null;
    tableRectRef.current = null;
  }, []);

  useEffect(() => {
    const tableKeys = new Set<NodeKey>();
    return mergeRegister(
      editor.registerMutationListener(TableNode, (nodeMutations) => {
        for (const [nodeKey, mutation] of nodeMutations) {
          if (mutation === "destroyed") {
            tableKeys.delete(nodeKey);
          } else {
            tableKeys.add(nodeKey);
          }
        }
        setHasTable(tableKeys.size > 0);
      }),
      editor.registerNodeTransform(TableNode, (tableNode) => {
        if (tableNode.getColWidths()) {
          return tableNode;
        }

        const numColumns = tableNode.getColumnCount();
        const columnWidth = MIN_COLUMN_WIDTH;

        tableNode.setColWidths(Array(numColumns).fill(columnWidth));
        return tableNode;
      }),
    );
  }, [editor]);

  useEffect(() => {
    if (!hasTable) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!isHTMLElement(target)) {
        return;
      }

      if (draggingDirection) {
        event.preventDefault();
        event.stopPropagation();
        updatePointerCurrentPos({
          x: event.clientX,
          y: event.clientY,
        });
        return;
      }
      if (resizerRef.current && resizerRef.current.contains(target)) {
        return;
      }

      if (targetRef.current !== target) {
        targetRef.current = target;
        const cell = getDOMCellFromTarget(target);

        if (cell && activeCell !== cell) {
          editor.getEditorState().read(
            () => {
              const tableCellNode = $getNearestNodeFromDOMNode(cell.elem);
              if (!tableCellNode) {
                throw new Error("TableCellResizer: Table cell node not found.");
              }

              const tableNode =
                $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
              const tableElement = getTableElement(
                tableNode,
                editor.getElementByKey(tableNode.getKey()),
              );

              if (!tableElement) {
                throw new Error("TableCellResizer: Table element not found.");
              }

              const rect = tableElement.getBoundingClientRect();
              tableRectRef.current = rect;
              setTableRect(rect);
              targetRef.current = target as HTMLElement;
              updateActiveCell(cell);
            },
            { editor },
          );
        } else if (cell == null) {
          resetState();
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const isTouchEvent = event.pointerType === "touch";
      if (isTouchEvent) {
        onPointerMove(event);
      }
    };

    const resizerContainer = resizerRef.current;
    resizerContainer?.addEventListener("pointermove", onPointerMove, {
      capture: true,
    });

    const removeRootListener = editor.registerRootListener(
      (rootElement, prevRootElement) => {
        prevRootElement?.removeEventListener("pointermove", onPointerMove);
        prevRootElement?.removeEventListener("pointerdown", onPointerDown);
        rootElement?.addEventListener("pointermove", onPointerMove);
        rootElement?.addEventListener("pointerdown", onPointerDown);
      },
    );

    return () => {
      removeRootListener();
      resizerContainer?.removeEventListener("pointermove", onPointerMove);
    };
  }, [activeCell, draggingDirection, editor, resetState, hasTable]);

  const isHeightChanging = (direction: PointerDraggingDirection) => {
    if (direction === "bottom") {
      return true;
    }
    return false;
  };

  const updateRowHeight = useCallback(
    (heightChange: number) => {
      if (!activeCell) {
        throw new Error("TableCellResizer: Expected active cell.");
      }

      editor.update(
        () => {
          const tableCellNode = $getNearestNodeFromDOMNode(activeCell.elem);
          if (!$isTableCellNode(tableCellNode)) {
            throw new Error("TableCellResizer: Table cell node not found.");
          }

          const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
          const baseRowIndex =
            $getTableRowIndexFromTableCellNode(tableCellNode);
          const tableRows = tableNode.getChildren();

          // Determine if this is a full row merge by checking colspan
          const isFullRowMerge =
            tableCellNode.getColSpan() === tableNode.getColumnCount();

          // For full row merges, apply to first row. For partial merges, apply to last row
          const tableRowIndex = isFullRowMerge
            ? baseRowIndex
            : baseRowIndex + tableCellNode.getRowSpan() - 1;

          if (tableRowIndex >= tableRows.length || tableRowIndex < 0) {
            throw new Error("Expected table cell to be inside of table row.");
          }

          const tableRow = tableRows[tableRowIndex];

          if (!$isTableRowNode(tableRow)) {
            throw new Error("Expected table row");
          }

          let height = tableRow.getHeight();
          if (height === undefined) {
            const rowCells = tableRow.getChildren<TableCellNode>();
            height = Math.min(
              ...rowCells.map(
                (cell) => getCellNodeHeight(cell, editor) ?? Infinity,
              ),
            );
          }

          const newHeight = Math.max(height + heightChange, MIN_ROW_HEIGHT);
          tableRow.setHeight(newHeight);
        },
        { tag: "skip-scroll-into-view" },
      );
    },
    [activeCell, editor],
  );

  const getCellNodeHeight = (
    cell: TableCellNode,
    activeEditor: LexicalEditor,
  ): number | undefined => {
    const domCellNode = activeEditor.getElementByKey(cell.getKey());
    return domCellNode?.clientHeight;
  };

  const getCellColumnIndex = (
    tableCellNode: TableCellNode,
    tableMap: TableMapType,
  ) => {
    for (const row of tableMap) {
      if (!row) continue;
      for (const [column, cellObj] of row.entries()) {
        if (cellObj && cellObj.cell === tableCellNode) {
          return column;
        }
      }
    }
  };

  const updateColumnWidth = useCallback(
    (widthChange: number) => {
      if (!activeCell) {
        throw new Error("TableCellResizer: Expected active cell.");
      }
      editor.update(
        () => {
          const tableCellNode = $getNearestNodeFromDOMNode(activeCell.elem);
          if (!$isTableCellNode(tableCellNode)) {
            throw new Error("TableCellResizer: Table cell node not found.");
          }

          const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
          const [tableMap] = $computeTableMapSkipCellCheck(
            tableNode,
            null,
            null,
          );
          const columnIndex = getCellColumnIndex(tableCellNode, tableMap);
          if (columnIndex === undefined) {
            throw new Error("TableCellResizer: Table column not found.");
          }

          const colWidths = tableNode.getColWidths();
          if (!colWidths) {
            return;
          }
          const width = colWidths[columnIndex];
          if (width === undefined) {
            return;
          }
          const newColWidths = [...colWidths];
          const newWidth = Math.max(width + widthChange, MIN_COLUMN_WIDTH);
          newColWidths[columnIndex] = newWidth;
          tableNode.setColWidths(newColWidths);
        },
        { tag: "skip-scroll-into-view" },
      );
    },
    [activeCell, editor],
  );

  const pointerUpHandler = useCallback(
    (direction: PointerDraggingDirection) => {
      const handler = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();

        if (!activeCell) {
          throw new Error("TableCellResizer: Expected active cell.");
        }

        if (pointerStartPosRef.current) {
          const { x, y } = pointerStartPosRef.current;

          if (activeCell === null) {
            return;
          }
          const zoom = calculateZoomLevel(event.target as Element);

          if (isHeightChanging(direction)) {
            const heightChange = (event.clientY - y) / zoom;
            updateRowHeight(heightChange);
          } else {
            const widthChange = (event.clientX - x) / zoom;
            updateColumnWidth(widthChange);
          }

          resetState();
          document.removeEventListener("pointerup", handler);
        }
      };
      return handler;
    },
    [activeCell, resetState, updateColumnWidth, updateRowHeight],
  );

  const toggleResize = useCallback(
    (
      direction: PointerDraggingDirection,
    ): PointerEventHandler<HTMLDivElement> =>
      (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!activeCell) {
          throw new Error("TableCellResizer: Expected active cell.");
        }

        pointerStartPosRef.current = {
          x: event.clientX,
          y: event.clientY,
        };
        updatePointerCurrentPos(pointerStartPosRef.current);
        updateDraggingDirection(direction);

        document.addEventListener("pointerup", pointerUpHandler(direction));
      },
    [activeCell, pointerUpHandler],
  );

  const getResizers = useCallback(() => {
    if (activeCell) {
      const { height, width, top, left } =
        activeCell.elem.getBoundingClientRect();
      const zoom = calculateZoomLevel(activeCell.elem);
      /* size of the invisible grab zones */
      const COL_ZONE = 32; // 16 px inside + 16 px outside
      const ROW_ZONE = 10; //  5 px inside +  5 px outside
      const styles: Record<string, CSSProperties> = {
        bottom: {
          backgroundColor: "none",
          cursor: "row-resize",
          height: `${ROW_ZONE}px`,
          left: `${window.scrollX + left}px`,
          top: `${window.scrollY + top + height - ROW_ZONE / 2}px`,
          width: `${width}px`,
          zIndex: 20 /* below the column ruler */,
        },
        right: {
          backgroundColor: "none",
          cursor: "col-resize",
          height: `${height}px`,
          left: `${window.scrollX + left + width - COL_ZONE / 2}px`,
          top: `${window.scrollY + top}px`,
          width: `${COL_ZONE}px`,
          zIndex: 21 /* always on top */,
        },
      };

      if (draggingDirection && pointerCurrentPos && tableRect) {
        const style = styles[draggingDirection];
        if (style) {
          if (isHeightChanging(draggingDirection)) {
            style.left = `${window.scrollX + tableRect.left}px`;
            style.top = `${window.scrollY + pointerCurrentPos.y / zoom}px`;
            style.height = "3px";
            style.width = `${tableRect.width}px`;
          } else {
            style.top = `${window.scrollY + tableRect.top}px`;
            style.left = `${window.scrollX + pointerCurrentPos.x / zoom}px`;
            style.width = "4px";
            style.height = `${tableRect.height}px`;
          }
          style.backgroundColor = "#adf";
          style.mixBlendMode = "unset";
          style.zIndex = 22; /* active guideline */
        }
      }

      return styles;
    }

    return {
      bottom: null,
      left: null,
      right: null,
      top: null,
    };
  }, [activeCell, draggingDirection, pointerCurrentPos, tableRect]);

  const resizerStyles = getResizers();

  return (
    <div ref={resizerRef}>
      {activeCell != null && (
        <>
          <div
            className={cn("absolute", "[touch-action:none]")}
            style={resizerStyles.right || undefined}
            onPointerDown={toggleResize("right")}
            data-coarse-style
          />
          <div
            className={cn("absolute", "[touch-action:none]")}
            style={resizerStyles.bottom || undefined}
            onPointerDown={toggleResize("bottom")}
            data-coarse-style
          />
        </>
      )}
    </div>
  );
}

export default function TableCellResizerPlugin(): null | ReactPortal {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();

  return useMemo(
    () =>
      isEditable
        ? createPortal(<TableCellResizer editor={editor} />, document.body)
        : null,
    [editor, isEditable],
  );
}
