import type {
  ElementNode,
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
  NodeKey,
} from "lexical";

import { $isHeadingNode } from "@lexical/rich-text";
import { $isTableSelection } from "@lexical/table";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $insertNodeToNearestRoot, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $isElementNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  DELETE_CHARACTER_COMMAND,
  getDOMSelection,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  SELECT_ALL_COMMAND,
} from "lexical";
import { useCallback, useEffect } from "react";

import {
  $columnOf,
  $columnsOf,
  $isEmptyColumn,
  $joinColumn,
  $leaveColumnsByLine,
  $leaveColumnsSideways,
  $pullNextColumn,
  $removeColumn,
  $repairColumns,
  $selectColumn,
  $unwrapColumns,
  LayoutContainerNode,
  LayoutItemNode,
  type LineLanding,
} from "@packages/lexical-nodes";

export const INSERT_LAYOUT_COMMAND: LexicalCommand<string> =
  createCommand<string>();

export const UPDATE_LAYOUT_COMMAND: LexicalCommand<{
  template: string;
  nodeKey: NodeKey;
}> = createCommand<{ template: string; nodeKey: NodeKey }>();

export function LayoutPlugin(): null {
  const [editor] = useLexicalComposerContext();

  const getItemsCountFromTemplate = useCallback((template: string): number => {
    return template.trim().split(/\s+/).length;
  }, []);

  useEffect(() => {
    if (!editor.hasNodes([LayoutContainerNode, LayoutItemNode])) {
      throw new Error(
        "LayoutPlugin: LayoutContainerNode, or LayoutItemNode not registered on editor",
      );
    }

    return mergeRegister(
      editor.registerCommand(
        DELETE_CHARACTER_COMMAND,
        (isBackward) =>
          isBackward ? $backspaceAtColumnStart() : $deleteAtColumnEnd(),
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        SELECT_ALL_COMMAND,
        $selectColumn,
        COMMAND_PRIORITY_LOW,
      ),
      // Arrows leave the columns where the browser would only move between
      // them, or not at all at the document's edge.
      ...(
        [
          [KEY_ARROW_UP_COMMAND, true],
          [KEY_ARROW_DOWN_COMMAND, false],
        ] as const
      ).map(([command, isBackward]) =>
        editor.registerCommand(
          command,
          (event) => {
            if (event?.shiftKey) return false;
            const left = $leaveColumnsByLine(isBackward, () =>
              $probeLine(editor, isBackward),
            );
            if (left) event?.preventDefault();
            return left;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
      ),
      ...(
        [
          [KEY_ARROW_LEFT_COMMAND, true],
          [KEY_ARROW_RIGHT_COMMAND, false],
        ] as const
      ).map(([command, isBackward]) =>
        editor.registerCommand(
          command,
          (event) => {
            if (event?.shiftKey || !$leaveColumnsSideways(isBackward))
              return false;
            event?.preventDefault();
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
      ),
      editor.registerCommand(
        INSERT_LAYOUT_COMMAND,
        (template) => {
          editor.update(() => {
            const container =
              LayoutContainerNode.$createLayoutContainerNode(template);
            const itemsCount = getItemsCountFromTemplate(template);

            for (let i = 0; i < itemsCount; i++) {
              container.append(
                LayoutItemNode.$createLayoutItemNode().append(
                  $createParagraphNode(),
                ),
              );
            }

            $insertNodeToNearestRoot(container);
            container.selectStart();
          });

          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        UPDATE_LAYOUT_COMMAND,
        ({ template, nodeKey }) => {
          editor.update(() => {
            const container = $getNodeByKey<LexicalNode>(nodeKey);

            if (!LayoutContainerNode.$isLayoutContainerNode(container)) {
              return;
            }

            const itemsCount = getItemsCountFromTemplate(template);
            const prevItemsCount = getItemsCountFromTemplate(
              container.getTemplateColumns(),
            );

            // A new column starts with an empty line; a column taken away
            // goes with what it holds.
            if (itemsCount > prevItemsCount) {
              for (let i = prevItemsCount; i < itemsCount; i++) {
                container.append(
                  LayoutItemNode.$createLayoutItemNode().append(
                    $createParagraphNode(),
                  ),
                );
              }
            } else if (itemsCount < prevItemsCount) {
              for (let i = prevItemsCount - 1; i >= itemsCount; i--) {
                const layoutItem = container.getChildAtIndex<LexicalNode>(i);

                if (LayoutItemNode.$isLayoutItemNode(layoutItem)) {
                  layoutItem.remove();
                }
              }
            }

            container.setTemplateColumns(template);
          });

          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      // A column outside a row of columns is just its blocks; a row is
      // repaired by $repairColumns.
      editor.registerNodeTransform(LayoutItemNode, (node) => {
        const parent = node.getParent<ElementNode>();
        if (!LayoutContainerNode.$isLayoutContainerNode(parent)) {
          const children = node.getChildren<LexicalNode>();
          for (const child of children) {
            node.insertBefore(child);
          }
          node.remove();
        }
      }),
      editor.registerNodeTransform(LayoutContainerNode, $repairColumns),
      markSelectedRow(editor),
    );
  }, [editor, getItemsCountFromTemplate]);

  return null;
}

/**
 * Marks the row of columns the selection is in with `data-columns-selected`,
 * which shows its columns' frames as hovering over the row does.
 */
function markSelectedRow(editor: LexicalEditor) {
  let marked: HTMLElement | null = null;
  return editor.registerUpdateListener(({ editorState }) => {
    const key = editorState.read(() => {
      // A table selection can hold nodes Lexical can't read back, over a
      // cell spanning past its table's end or of a cell gone, and its
      // anchor's node can be gone; the row is looked up only if it isn't.
      const selection = $getSelection();
      const node =
        $isRangeSelection(selection) || $isTableSelection(selection)
          ? $getNodeByKey(selection.anchor.key)
          : selection?.getNodes()[0];
      const column = node && $columnOf(node);
      return column ? $columnsOf(column).getKey() : null;
    });
    const row = key ? editor.getElementByKey(key) : null;
    if (row === marked) return;
    marked?.removeAttribute("data-columns-selected");
    row?.setAttribute("data-columns-selected", "true");
    marked = row;
  });
}

/**
 * The caret's column and that column's first block, when the caret is at
 * the start of that block.
 */
function $caretAtColumnStart() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  const column = $columnOf(anchor.getNode());
  const block = column?.getFirstChild();
  if (!column || !block || anchor.offset !== 0) return null;
  const node = anchor.getNode();
  const first = $isElementNode(block) ? block.getFirstDescendant() : null;
  return node.is(block) || node.is(first) ? { column, block } : null;
}

/**
 * Backspace at the start of a column takes away the boundary before it: an
 * empty column goes, another joins the column before it, and the first
 * turns the columns back into blocks. Blocks with a Backspace of their own,
 * as a list item has, keep it.
 */
function $backspaceAtColumnStart() {
  const caret = $caretAtColumnStart();
  if (!caret) return false;
  const { column, block } = caret;
  if ($isEmptyColumn(column)) {
    $removeColumn(column);
    return true;
  }
  if (!$isParagraphNode(block) && !$isHeadingNode(block)) return false;
  if (column.getPreviousSibling()) $joinColumn(column);
  else $unwrapColumns($columnsOf(column));
  return true;
}

/**
 * The caret's column and that column's last block, when the caret is at
 * the end of that block.
 */
function $caretAtColumnEnd() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  const node = anchor.getNode();
  const column = $columnOf(node);
  const block = column?.getLastChild();
  if (!column || !block) return null;
  const size = $isElementNode(node)
    ? node.getChildrenSize()
    : node.getTextContentSize();
  const last = $isElementNode(block) ? block.getLastDescendant() : null;
  return anchor.offset === size && (node.is(block) || node.is(last))
    ? { column, block }
    : null;
}

/**
 * Delete at the end of a column takes away the boundary after it, pulling
 * the next column in; at the end of the last column it does nothing, so
 * the row is never lost by accident.
 */
function $deleteAtColumnEnd() {
  const caret = $caretAtColumnEnd();
  if (!caret) return false;
  const { column, block } = caret;
  if (!$isParagraphNode(block) && !$isHeadingNode(block)) return false;
  $pullNextColumn(column);
  return true;
}

/**
 * Where the browser's line move would take the caret, asked of the DOM's
 * selection and put back, as rich text's line move onto decorators asks.
 */
function $probeLine(editor: LexicalEditor, isBackward: boolean): LineLanding {
  const root = editor.getRootElement();
  const selection = root && getDOMSelection(root.ownerDocument.defaultView);
  if (!selection || selection.rangeCount === 0) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  selection.modify("move", isBackward ? "backward" : "forward", "line");
  const moved = selection.anchorNode;
  const movedOffset = selection.anchorOffset;
  if (anchorNode && focusNode)
    selection.setBaseAndExtent(
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset,
    );
  if (!moved) return null;
  if (moved === anchorNode && movedOffset === anchorOffset) return "stayed";
  return $getNearestNodeFromDOMNode(moved);
}
