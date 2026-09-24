import type { ElementNode, LexicalEditor, LexicalNode } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getNodeTriplet,
  $getTableCellNodeFromLexicalNode,
  $getTableColumnIndexFromTableCellNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $getTableRowIndexFromTableCellNode,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableRowNode,
  $isTableSelection,
  $unmergeCell,
  getTableObserverFromTableElement,
  getTableElement,
  type HTMLTableElementWithWithTableSelectionState,
  TableCellHeaderStates,
  TableCellNode,
  type TableRowNode,
  type TableSelection,
} from "@lexical/table";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
} from "lexical";
import type * as React from "react";
import {
  type ReactPortal,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import useModal from "~/hooks/useModal";
import { ColorPickerContent } from "~/components/ui/color-picker";
import { ChevronDown } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

type TableCellActionMenuProps = Readonly<{
  onClose: () => void;
  showColorPickerModal: (
    title: string,
    showModal: (onClose: () => void) => React.JSX.Element,
  ) => void;
  tableCellNode: TableCellNode;
  cellMerge: boolean;
}>;

function TableActionMenu({
  onClose,
  tableCellNode: _tableCellNode,
  cellMerge,
  showColorPickerModal,
}: TableCellActionMenuProps) {
  const [editor] = useLexicalComposerContext();
  const [tableCellNode, updateTableCellNode] = useState(_tableCellNode);
  const [selectionCounts, updateSelectionCounts] = useState({
    columns: 1,
    rows: 1,
  });
  const [canMergeCells, setCanMergeCells] = useState(false);
  const [canUnmergeCell, setCanUnmergeCell] = useState(false);

  const currentCellBackgroundColor = useCallback(
    (editor: LexicalEditor): null | string => {
      return editor.getEditorState().read(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection) || $isTableSelection(selection)) {
          const [cell] = $getNodeTriplet(selection.anchor);
          if ($isTableCellNode(cell)) {
            return cell.getBackgroundColor();
          }
        }
        return null;
      });
    },
    [],
  );

  const [backgroundColor, setBackgroundColor] = useState(
    () => currentCellBackgroundColor(editor) || "",
  );

  // This is important when merging cells as there is no good way to re-merge weird shapes (a result
  // of selecting merged cells and non-merged)
  const isTableSelectionRectangular = useCallback(
    (selection: TableSelection): boolean => {
      const nodes = selection.getNodes();
      const currentRows: number[] = [];
      let currentRow = null;
      let expectedColumns = null;
      let currentColumns = 0;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if ($isTableCellNode(node)) {
          const row = node.getParentOrThrow();
          if (!$isTableRowNode(row)) {
            throw new Error("Expected CellNode to have a RowNode parent");
          }
          if (currentRow !== row) {
            if (
              expectedColumns !== null &&
              currentColumns !== expectedColumns
            ) {
              return false;
            }
            if (currentRow !== null) {
              expectedColumns = currentColumns;
            }
            currentRow = row;
            currentColumns = 0;
          }
          const colSpan = node.__colSpan;
          for (let j = 0; j < colSpan; j++) {
            if (currentRows[currentColumns + j] === undefined) {
              currentRows[currentColumns + j] = 0;
            }
            (currentRows[currentColumns + j] as number) += node.__rowSpan;
          }
          currentColumns += colSpan;
        }
      }
      return (
        (expectedColumns === null || currentColumns === expectedColumns) &&
        currentRows.every((v) => v === currentRows[0])
      );
    },
    [],
  );

  const $canUnmerge = useCallback((): boolean => {
    const selection = $getSelection();
    if (
      ($isRangeSelection(selection) && !selection.isCollapsed()) ||
      ($isTableSelection(selection) && !selection.anchor.is(selection.focus)) ||
      (!$isRangeSelection(selection) && !$isTableSelection(selection))
    ) {
      return false;
    }
    const [cell] = $getNodeTriplet(selection.anchor);
    return cell.__colSpan > 1 || cell.__rowSpan > 1;
  }, []);

  const $cellContainsEmptyParagraph = (cell: TableCellNode): boolean => {
    if (cell.getChildrenSize() !== 1) {
      return false;
    }
    const firstChild = cell.getFirstChildOrThrow();
    if (!$isParagraphNode(firstChild) || !firstChild.isEmpty()) {
      return false;
    }
    return true;
  };

  const $selectLastDescendant = (node: ElementNode): void => {
    const lastDescendant = node.getLastDescendant();
    if ($isTextNode(lastDescendant)) {
      lastDescendant.select();
    } else if ($isElementNode(lastDescendant)) {
      lastDescendant.selectEnd();
    } else if (lastDescendant !== null) {
      lastDescendant.selectNext();
    }
  };

  const computeSelectionCount = useCallback(
    (
      selection: TableSelection,
    ): {
      columns: number;
      rows: number;
    } => {
      const selectionShape = selection.getShape();
      return {
        columns: selectionShape.toX - selectionShape.fromX + 1,
        rows: selectionShape.toY - selectionShape.fromY + 1,
      };
    },
    [],
  );

  useEffect(() => {
    return editor.registerMutationListener(TableCellNode, (nodeMutations) => {
      const nodeUpdated =
        nodeMutations.get(tableCellNode.getKey()) === "updated";

      if (nodeUpdated) {
        editor.getEditorState().read(() => {
          updateTableCellNode(tableCellNode.getLatest());
        });
        setBackgroundColor(currentCellBackgroundColor(editor) || "");
      }
    });
  }, [currentCellBackgroundColor, editor, tableCellNode]);

  useEffect(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      // Merge cells
      if ($isTableSelection(selection)) {
        const currentSelectionCounts = computeSelectionCount(selection);
        updateSelectionCounts(computeSelectionCount(selection));
        setCanMergeCells(
          isTableSelectionRectangular(selection) &&
            (currentSelectionCounts.columns > 1 ||
              currentSelectionCounts.rows > 1),
        );
      }
      // Unmerge cell
      setCanUnmergeCell($canUnmerge());
    });
  }, [computeSelectionCount, editor, $canUnmerge, isTableSelectionRectangular]);

  const clearTableSelection = useCallback(() => {
    editor.update(() => {
      if (tableCellNode.isAttached()) {
        const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
        const tableElement = getTableElement(
          tableNode,
          editor.getElementByKey(tableNode.getKey()),
        ) as HTMLTableElementWithWithTableSelectionState | null;

        if (!tableElement) {
          throw new Error("Expected to find tableElement in DOM");
        }

        const tableSelection = getTableObserverFromTableElement(tableElement);
        if (tableSelection !== null) {
          tableSelection.$clearHighlight();
        }

        tableNode.markDirty();
        updateTableCellNode(tableCellNode.getLatest());
      }

      const rootNode = $getRoot();
      rootNode.selectStart();
    });
  }, [editor, tableCellNode]);

  const mergeTableCellsAtSelection = () => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isTableSelection(selection)) {
        const { columns, rows } = computeSelectionCount(selection);
        const nodes = selection.getNodes();
        let firstCell: null | TableCellNode = null;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if ($isTableCellNode(node)) {
            if (firstCell === null) {
              node.setColSpan(columns).setRowSpan(rows);
              firstCell = node;
              const isEmpty = $cellContainsEmptyParagraph(node);
              let firstChild: LexicalNode | null = null;
              if (isEmpty) {
                firstChild = node.getFirstChild();
              }
              if (isEmpty && $isParagraphNode(firstChild)) {
                firstChild.remove();
              }
            } else if ($isTableCellNode(firstCell)) {
              const isEmpty = $cellContainsEmptyParagraph(node);
              if (!isEmpty) {
                firstCell.append(...node.getChildren());
              }
              node.remove();
            }
          }
        }
        if (firstCell !== null) {
          if (firstCell.getChildrenSize() === 0) {
            firstCell.append($createParagraphNode());
          }
          $selectLastDescendant(firstCell);
        }
        onClose();
      }
    });
  };

  const unmergeTableCellsAtSelection = () => {
    editor.update(() => {
      $unmergeCell();
    });
  };

  const insertTableRowAtSelection = useCallback(
    (shouldInsertAfter: boolean) => {
      editor.update(() => {
        $insertTableRowAtSelection(shouldInsertAfter);
        onClose();
      });
    },
    [editor, onClose],
  );

  const insertTableColumnAtSelection = useCallback(
    (shouldInsertAfter: boolean) => {
      editor.update(() => {
        for (let i = 0; i < selectionCounts.columns; i++) {
          $insertTableColumnAtSelection(shouldInsertAfter);
        }
        onClose();
      });
    },
    [editor, onClose, selectionCounts.columns],
  );

  const deleteTableRowAtSelection = useCallback(() => {
    editor.update(() => {
      $deleteTableRowAtSelection();
      onClose();
    });
  }, [editor, onClose]);

  const deleteTableAtSelection = useCallback(() => {
    editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);
      tableNode.remove();

      clearTableSelection();
      onClose();
    });
  }, [editor, tableCellNode, clearTableSelection, onClose]);

  const deleteTableColumnAtSelection = useCallback(() => {
    editor.update(() => {
      $deleteTableColumnAtSelection();
      onClose();
    });
  }, [editor, onClose]);

  const toggleTableRowIsHeader = useCallback(() => {
    editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);

      const tableRowIndex = $getTableRowIndexFromTableCellNode(tableCellNode);

      const tableRows = tableNode.getChildren();

      if (tableRowIndex >= tableRows.length || tableRowIndex < 0) {
        throw new Error("Expected table cell to be inside of table row.");
      }

      const tableRow = tableRows[tableRowIndex];

      if (!$isTableRowNode(tableRow)) {
        throw new Error("Expected table row");
      }

      for (const tableCell of tableRow.getChildren()) {
        if (!$isTableCellNode(tableCell)) {
          throw new Error("Expected table cell");
        }

        tableCell.toggleHeaderStyle(TableCellHeaderStates.ROW);
      }

      clearTableSelection();
      onClose();
    });
  }, [editor, tableCellNode, clearTableSelection, onClose]);

  const toggleTableColumnIsHeader = useCallback(() => {
    editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);

      const tableColumnIndex =
        $getTableColumnIndexFromTableCellNode(tableCellNode);

      const tableRows = tableNode.getChildren<TableRowNode>();
      const maxRowsLength = Math.max(
        ...tableRows.map((row) => row.getChildren().length),
      );

      if (tableColumnIndex >= maxRowsLength || tableColumnIndex < 0) {
        throw new Error("Expected table cell to be inside of table row.");
      }

      for (let r = 0; r < tableRows.length; r++) {
        const tableRow = tableRows[r];

        if (!$isTableRowNode(tableRow)) {
          throw new Error("Expected table row");
        }

        const tableCells = tableRow.getChildren();
        if (tableColumnIndex >= tableCells.length) {
          // if cell is outside of bounds for the current row (for example various merge cell cases) we shouldn't highlight it
          continue;
        }

        const tableCell = tableCells[tableColumnIndex];

        if (!$isTableCellNode(tableCell)) {
          throw new Error("Expected table cell");
        }

        tableCell.toggleHeaderStyle(TableCellHeaderStates.COLUMN);
      }

      clearTableSelection();
      onClose();
    });
  }, [editor, tableCellNode, clearTableSelection, onClose]);

  const handleCellBackgroundColor = useCallback(
    (value: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection) || $isTableSelection(selection)) {
          const [cell] = $getNodeTriplet(selection.anchor);
          if ($isTableCellNode(cell)) {
            cell.setBackgroundColor(value);
          }

          if ($isTableSelection(selection)) {
            const nodes = selection.getNodes();

            for (let i = 0; i < nodes.length; i++) {
              const node = nodes[i];
              if ($isTableCellNode(node)) {
                node.setBackgroundColor(value);
              }
            }
          }
        }
      });
    },
    [editor],
  );

  let mergeCellButton: null | React.JSX.Element = null;
  if (cellMerge) {
    if (canMergeCells) {
      mergeCellButton = (
        <DropdownMenuItem onClick={() => mergeTableCellsAtSelection()}>
          Merge cells
        </DropdownMenuItem>
      );
    } else if (canUnmergeCell) {
      mergeCellButton = (
        <DropdownMenuItem onClick={() => unmergeTableCellsAtSelection()}>
          Unmerge cells
        </DropdownMenuItem>
      );
    }
  }

  return (
    <DropdownMenuContent
      side="right"
      align="start"
      sideOffset={4}
      collisionPadding={8}
      className="max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      {mergeCellButton}
      <DropdownMenuItem
        onClick={() =>
          showColorPickerModal("Cell background color", () => (
            <ColorPickerContent
              color={backgroundColor}
              onChange={handleCellBackgroundColor}
              className="min-w-[300px]"
            />
          ))
        }
      >
        <span className="text">Background color</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => insertTableRowAtSelection(false)}>
        <span className="text">
          Insert{" "}
          {selectionCounts.rows === 1 ? "row" : `${selectionCounts.rows} rows`}{" "}
          above
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => insertTableRowAtSelection(true)}>
        <span className="text">
          Insert{" "}
          {selectionCounts.rows === 1 ? "row" : `${selectionCounts.rows} rows`}{" "}
          below
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={() => insertTableColumnAtSelection(false)}>
        <span className="text">
          Insert{" "}
          {selectionCounts.columns === 1
            ? "column"
            : `${selectionCounts.columns} columns`}{" "}
          left
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => insertTableColumnAtSelection(true)}>
        <span className="text">
          Insert{" "}
          {selectionCounts.columns === 1
            ? "column"
            : `${selectionCounts.columns} columns`}{" "}
          right
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={
          (tableCellNode.__headerState & TableCellHeaderStates.ROW) !== 0
        }
        onCheckedChange={toggleTableRowIsHeader}
      >
        Header row
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={
          (tableCellNode.__headerState & TableCellHeaderStates.COLUMN) !== 0
        }
        onCheckedChange={toggleTableColumnIsHeader}
      >
        Header column
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onClick={deleteTableColumnAtSelection}
      >
        Delete column
      </DropdownMenuItem>
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onClick={deleteTableRowAtSelection}
      >
        Delete row
      </DropdownMenuItem>
      <DropdownMenuItem
        className="text-destructive focus:text-destructive"
        onClick={deleteTableAtSelection}
      >
        Delete table
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

function TableCellActionMenuContainer({
  cellMerge,
}: {
  cellMerge: boolean;
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext();

  const menuButtonRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const [tableCellNode, setTableMenuCellNode] = useState<TableCellNode | null>(
    null,
  );

  const [colorPickerModal, showColorPickerModal] = useModal();

  const $moveMenu = useCallback(() => {
    const menu = menuButtonRef.current;
    const selection = $getSelection();
    const nativeSelection = window.getSelection();
    const activeElement = document.activeElement;

    if (selection == null || menu == null) {
      setTableMenuCellNode(null);
      return;
    }

    const rootElement = editor.getRootElement();

    if (
      $isRangeSelection(selection) &&
      rootElement !== null &&
      nativeSelection !== null &&
      rootElement.contains(nativeSelection.anchorNode)
    ) {
      const tableCellNodeFromSelection = $getTableCellNodeFromLexicalNode(
        selection.anchor.getNode(),
      );

      if (tableCellNodeFromSelection == null) {
        setTableMenuCellNode(null);
        return;
      }

      const tableCellParentNodeDOM = editor.getElementByKey(
        tableCellNodeFromSelection.getKey(),
      );

      if (tableCellParentNodeDOM == null) {
        setTableMenuCellNode(null);
        return;
      }

      setTableMenuCellNode(tableCellNodeFromSelection);
    } else if (!activeElement) {
      setTableMenuCellNode(null);
    }
  }, [editor]);

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        $moveMenu();
      });
    });
  });

  // The selection lives in Lexical; its anchor moves with nested scroll regions.
  useEffect(() => {
    const position = () => {
      const menu = menuButtonRef.current;
      const cell =
        tableCellNode && editor.getElementByKey(tableCellNode.getKey());
      if (!menu || !cell) return;
      const rect = cell.getBoundingClientRect();
      const region = cell
        .closest(".document-table-region")
        ?.getBoundingClientRect();
      const right = Math.min(
        rect.right,
        region?.right ?? innerWidth,
        innerWidth - 8,
      );
      const top = Math.max(rect.top, region?.top ?? 0) + 8;
      menu.style.visibility =
        rect.bottom < 0 || top > innerHeight || right < 24
          ? "hidden"
          : "visible";
      menu.style.transform = `translate(${right - menu.offsetWidth - 8}px, ${top}px)`;
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [tableCellNode, editor]);

  const prevTableCellDOM = useRef(tableCellNode);

  useEffect(() => {
    if (prevTableCellDOM.current !== tableCellNode) {
      setIsMenuOpen(false);
    }

    prevTableCellDOM.current = tableCellNode;
  }, [tableCellNode]);

  return (
    <div
      className="fixed top-0 left-0 z-30 will-change-transform"
      ref={menuButtonRef}
    >
      {tableCellNode != null && (
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              aria-label="Table cell actions"
              aria-expanded={isMenuOpen}
              variant="outline"
              size="icon"
              className="flex justify-center items-center border-0 size-6 pointer-coarse:size-11"
            >
              <ChevronDown className="size-4" />
              <span className="sr-only">Table cell actions</span>
            </Button>
          </DropdownMenuTrigger>
          {colorPickerModal}
          {isMenuOpen && (
            <TableActionMenu
              onClose={() => setIsMenuOpen(false)}
              tableCellNode={tableCellNode}
              cellMerge={cellMerge}
              showColorPickerModal={showColorPickerModal}
            />
          )}
        </DropdownMenu>
      )}
    </div>
  );
}

export default function TableActionMenuPlugin({
  cellMerge = false,
}: {
  anchorElem?: HTMLElement;
  cellMerge?: boolean;
}): null | ReactPortal {
  const isEditable = useLexicalEditable();
  return createPortal(
    isEditable ? <TableCellActionMenuContainer cellMerge={cellMerge} /> : null,
    document.body,
  );
}
