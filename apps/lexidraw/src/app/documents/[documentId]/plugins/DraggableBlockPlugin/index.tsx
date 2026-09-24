import "./index.css";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { eventFiles } from "@lexical/rich-text";
import { calculateZoomLevel, mergeRegister } from "@lexical/utils";
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DRAGOVER_COMMAND,
  DROP_COMMAND,
  isHTMLElement,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import { GripVertical, Plus } from "lucide-react";
import type * as React from "react";
import {
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useFinePointer } from "~/hooks/use-media-query";
import { Point } from "../../utils/point";
import { Rect } from "../../utils/rect";
import { $blockTypeOf, BlockActionItems } from "../ToolbarPlugin/block-actions";
import { insertBlockBelow } from "../ToolbarPlugin/block-commands";
import type { BlockType } from "../ToolbarPlugin/block-format";

function useDraggableBlockMenu(
  editor: LexicalEditor,
  anchorElem: HTMLElement,
  isEditable: boolean,
): React.JSX.Element {
  const SPACE = 4;
  const TARGET_LINE_HALF_HEIGHT = 2;
  const DRAGGABLE_BLOCK_MENU_CLASSNAME = "draggable-block-menu";
  const DRAG_DATA_FORMAT = "application/x-lexical-drag-block";
  const TEXT_BOX_HORIZONTAL_PADDING = 28;

  const Downward = 1;
  const Upward = -1;
  const Indeterminate = 0;

  const prevIndexRef = useRef(Infinity);

  const getCurrentIndex = useCallback((keysLength: number): number => {
    if (keysLength === 0) {
      return Infinity;
    }
    if (prevIndexRef.current >= 0 && prevIndexRef.current < keysLength) {
      return prevIndexRef.current;
    }

    return Math.floor(keysLength / 2);
  }, []);

  const getTopLevelNodeKeys = useCallback((editor: LexicalEditor): string[] => {
    return editor.getEditorState().read(() => $getRoot().getChildrenKeys());
  }, []);

  const getCollapsedMargins = useCallback(
    (
      elem: HTMLElement,
    ): {
      marginTop: number;
      marginBottom: number;
    } => {
      const getMargin = (
        element: Element | null,
        margin: "marginTop" | "marginBottom",
      ): number =>
        element ? parseFloat(window.getComputedStyle(element)[margin]) : 0;

      const { marginTop, marginBottom } = window.getComputedStyle(elem);
      const prevElemSiblingMarginBottom = getMargin(
        elem.previousElementSibling,
        "marginBottom",
      );
      const nextElemSiblingMarginTop = getMargin(
        elem.nextElementSibling,
        "marginTop",
      );
      const collapsedTopMargin = Math.max(
        parseFloat(marginTop),
        prevElemSiblingMarginBottom,
      );
      const collapsedBottomMargin = Math.max(
        parseFloat(marginBottom),
        nextElemSiblingMarginTop,
      );

      return {
        marginBottom: collapsedBottomMargin,
        marginTop: collapsedTopMargin,
      };
    },
    [],
  );

  const getBlockElement = useCallback(
    (
      anchorElem: HTMLElement,
      editor: LexicalEditor,
      event: MouseEvent,
      useEdgeAsDefault = false,
    ): HTMLElement | null => {
      const anchorElementRect = anchorElem.getBoundingClientRect();
      const topLevelNodeKeys = getTopLevelNodeKeys(editor);

      if (!topLevelNodeKeys[0]) {
        return null;
      }

      let blockElem: HTMLElement | null = null;

      editor.getEditorState().read(() => {
        if (useEdgeAsDefault) {
          const [firstNode, lastNode] = [
            editor.getElementByKey(topLevelNodeKeys[0] as string),
            editor.getElementByKey(
              topLevelNodeKeys[topLevelNodeKeys.length - 1] as string,
            ),
          ];

          const [firstNodeRect, lastNodeRect] = [
            firstNode?.getBoundingClientRect(),
            lastNode?.getBoundingClientRect(),
          ];

          if (firstNodeRect && lastNodeRect) {
            const firstNodeZoom = calculateZoomLevel(firstNode);
            const lastNodeZoom = calculateZoomLevel(lastNode);
            if (event.y / firstNodeZoom < firstNodeRect.top) {
              blockElem = firstNode;
            } else if (event.y / lastNodeZoom > lastNodeRect.bottom) {
              blockElem = lastNode;
            }

            if (blockElem) {
              return;
            }
          }
        }

        let index = getCurrentIndex(topLevelNodeKeys.length);
        let direction = Indeterminate;

        while (index >= 0 && index < topLevelNodeKeys.length) {
          const key = topLevelNodeKeys[index];
          if (!key) {
            break;
          }
          const elem = editor.getElementByKey(key);
          if (elem === null) {
            break;
          }
          const zoom = calculateZoomLevel(elem);
          const point = new Point(event.x / zoom, event.y / zoom);
          const domRect = Rect.fromDOM(elem);
          const { marginTop, marginBottom } = getCollapsedMargins(elem);
          const rect = domRect.generateNewRect({
            bottom: domRect.bottom + marginBottom,
            left: anchorElementRect.left,
            right: anchorElementRect.right,
            top: domRect.top - marginTop,
          });

          const {
            result,
            reason: { isOnTopSide, isOnBottomSide },
          } = rect.contains(point);

          if (result) {
            blockElem = elem;
            prevIndexRef.current = index;
            break;
          }

          if (direction === Indeterminate) {
            if (isOnTopSide) {
              direction = Upward;
            } else if (isOnBottomSide) {
              direction = Downward;
            } else {
              // stop search block element
              direction = Infinity;
            }
          }

          index += direction;
        }
      });

      return blockElem;
    },
    [getCurrentIndex, getTopLevelNodeKeys, getCollapsedMargins],
  );

  const setMenuPosition = useCallback(
    (
      targetElem: HTMLElement | null,
      floatingElem: HTMLElement,
      anchorElem: HTMLElement,
    ) => {
      if (!targetElem) {
        floatingElem.style.opacity = "0";
        floatingElem.style.transform = "translate(-10000px, -10000px)";
        return;
      }

      const targetRect = targetElem.getBoundingClientRect();
      const targetStyle = window.getComputedStyle(targetElem);
      const floatingElemRect = floatingElem.getBoundingClientRect();
      const anchorElementRect = anchorElem.getBoundingClientRect();

      const lineHeight =
        parseInt(targetStyle.lineHeight, 10) || floatingElemRect.height;
      const top =
        targetRect.top +
        parseInt(targetStyle.paddingTop, 10) +
        (lineHeight - floatingElemRect.height) / 2 -
        anchorElementRect.top;
      const left = Math.max(
        0,
        targetRect.left -
          anchorElementRect.left -
          floatingElemRect.width -
          SPACE,
      );

      floatingElem.style.opacity = "1";
      floatingElem.style.transform = `translate(${left}px, ${top}px)`;
    },
    [],
  );

  const setDragImage = useCallback(
    (dataTransfer: DataTransfer, draggableBlockElem: HTMLElement) => {
      const { transform } = draggableBlockElem.style;

      // Remove dragImage borders
      draggableBlockElem.style.transform = "translateZ(0)";
      dataTransfer.setDragImage(draggableBlockElem, 0, 0);

      setTimeout(() => {
        draggableBlockElem.style.transform = transform;
      });
    },
    [],
  );

  const setTargetLine = useCallback(
    (
      targetLineElem: HTMLElement,
      targetBlockElem: HTMLElement,
      mouseY: number,
      anchorElem: HTMLElement,
    ) => {
      const { top: targetBlockElemTop, height: targetBlockElemHeight } =
        targetBlockElem.getBoundingClientRect();
      const { top: anchorTop, width: anchorWidth } =
        anchorElem.getBoundingClientRect();
      const { marginTop, marginBottom } = getCollapsedMargins(targetBlockElem);
      let lineTop = targetBlockElemTop;
      if (mouseY >= targetBlockElemTop) {
        lineTop += targetBlockElemHeight + marginBottom / 2;
      } else {
        lineTop -= marginTop / 2;
      }

      const top = lineTop - anchorTop - TARGET_LINE_HALF_HEIGHT;
      const left = TEXT_BOX_HORIZONTAL_PADDING - SPACE;

      targetLineElem.style.transform = `translate(${left}px, ${top}px)`;
      targetLineElem.style.width = `${
        anchorWidth - (TEXT_BOX_HORIZONTAL_PADDING - SPACE) * 2
      }px`;
      targetLineElem.style.opacity = ".4";
    },
    [getCollapsedMargins],
  );

  const hideTargetLine = useCallback((targetLineElem: HTMLElement | null) => {
    if (targetLineElem) {
      targetLineElem.style.opacity = "0";
      targetLineElem.style.transform = "translate(-10000px, -10000px)";
    }
  }, []);

  const scrollerElem = anchorElem.parentElement;

  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);
  const isDraggingBlockRef = useRef<boolean>(false);
  const [draggableBlockElem, setDraggableBlockElem] =
    useState<HTMLElement | null>(null);

  const isOnMenu = useCallback((element: HTMLElement): boolean => {
    return !!element.closest(`.${DRAGGABLE_BLOCK_MENU_CLASSNAME}`);
  }, []);

  const [menu, setMenu] = useState<{
    key: NodeKey;
    blockType: BlockType | null;
    canTurnInto: boolean;
  } | null>(null);

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      if (menu) return;
      const target = event.target;
      if (!isHTMLElement(target)) {
        setDraggableBlockElem(null);
        return;
      }

      if (isOnMenu(target)) {
        return;
      }

      const _draggableBlockElem = getBlockElement(anchorElem, editor, event);

      setDraggableBlockElem(_draggableBlockElem);
    },
    [anchorElem, editor, getBlockElement, isOnMenu, menu],
  );

  const onMouseLeave = useCallback(() => {
    if (!menu) setDraggableBlockElem(null);
  }, [menu]);

  const blockKey = () =>
    draggableBlockElem
      ? editor.read(() =>
          $getNearestNodeFromDOMNode(draggableBlockElem)?.getKey(),
        )
      : undefined;

  const openMenu = () => {
    const key = blockKey();
    if (!key) return;
    editor.read(() => {
      const node = $getNodeByKey(key);
      setMenu({
        key,
        blockType: $blockTypeOf(node),
        canTurnInto: $isElementNode(node),
      });
    });
  };

  useEffect(() => {
    scrollerElem?.addEventListener("mousemove", onMouseMove);
    scrollerElem?.addEventListener("mouseleave", onMouseLeave);

    return () => {
      scrollerElem?.removeEventListener("mousemove", onMouseMove);
      scrollerElem?.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [scrollerElem, onMouseMove, onMouseLeave]);

  useEffect(() => {
    if (menuRef.current) {
      setMenuPosition(draggableBlockElem, menuRef.current, anchorElem);
    }
  }, [anchorElem, draggableBlockElem, setMenuPosition]);

  useEffect(() => {
    function onDragover(event: DragEvent): boolean {
      if (!isDraggingBlockRef.current) {
        return false;
      }
      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }
      const { pageY, target } = event;
      if (!isHTMLElement(target)) {
        return false;
      }
      const targetBlockElem = getBlockElement(anchorElem, editor, event, true);
      const targetLineElem = targetLineRef.current;
      if (targetBlockElem === null || targetLineElem === null) {
        return false;
      }
      setTargetLine(
        targetLineElem,
        targetBlockElem,
        pageY / calculateZoomLevel(target),
        anchorElem,
      );
      // Prevent default event to be able to trigger onDrop events
      event.preventDefault();
      return true;
    }

    function $onDrop(event: DragEvent): boolean {
      if (!isDraggingBlockRef.current) {
        return false;
      }
      const [isFileTransfer] = eventFiles(event);
      if (isFileTransfer) {
        return false;
      }
      const { target, dataTransfer, pageY } = event;
      const dragData = dataTransfer?.getData(DRAG_DATA_FORMAT) || "";
      const draggedNode = $getNodeByKey(dragData);
      if (!draggedNode) {
        return false;
      }
      if (!isHTMLElement(target)) {
        return false;
      }
      const targetBlockElem = getBlockElement(anchorElem, editor, event, true);
      if (!targetBlockElem) {
        return false;
      }
      const targetNode = $getNearestNodeFromDOMNode(targetBlockElem);
      if (!targetNode) {
        return false;
      }
      if (targetNode === draggedNode) {
        return true;
      }
      const targetBlockElemTop = targetBlockElem.getBoundingClientRect().top;
      if (pageY / calculateZoomLevel(target) >= targetBlockElemTop) {
        targetNode.insertAfter(draggedNode);
      } else {
        targetNode.insertBefore(draggedNode);
      }
      setDraggableBlockElem(null);

      return true;
    }

    return mergeRegister(
      editor.registerCommand(
        DRAGOVER_COMMAND,
        (event) => {
          return onDragover(event);
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DROP_COMMAND,
        (event) => {
          return $onDrop(event);
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [anchorElem, editor, getBlockElement, setTargetLine]);

  const onDragStart = useCallback(
    (event: ReactDragEvent<HTMLButtonElement>): void => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer || !draggableBlockElem) {
        return;
      }
      setDragImage(dataTransfer, draggableBlockElem);
      let nodeKey = "";
      editor.update(() => {
        const node = $getNearestNodeFromDOMNode(draggableBlockElem);
        if (node) {
          nodeKey = node.getKey();
        }
      });
      isDraggingBlockRef.current = true;
      dataTransfer.setData(DRAG_DATA_FORMAT, nodeKey);
    },
    [draggableBlockElem, editor, setDragImage],
  );

  const onDragEnd = useCallback((): void => {
    isDraggingBlockRef.current = false;
    hideTargetLine(targetLineRef.current);
  }, [hideTargetLine]);

  return createPortal(
    <>
      <div
        className={`${DRAGGABLE_BLOCK_MENU_CLASSNAME} flex items-center text-muted-foreground`}
        ref={menuRef}
      >
        {isEditable && (
          <>
            <button
              type="button"
              aria-label="Insert a block below"
              title="Insert a block below"
              className="flex size-6 items-center justify-center rounded-sm hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => {
                const key = blockKey();
                if (key) insertBlockBelow(editor, key);
              }}
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Block actions"
              title="Drag to move, click for actions"
              draggable={true}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onClick={openMenu}
              className="flex h-6 w-5 cursor-grab items-center justify-center rounded-sm hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
          </>
        )}
        <DropdownMenu
          open={menu !== null}
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              className="absolute right-0 bottom-0 size-0"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            {menu && (
              <BlockActionItems
                editor={editor}
                nodeKey={menu.key}
                blockType={menu.blockType}
                canTurnInto={menu.canTurnInto}
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="draggable-block-target-line" ref={targetLineRef} />
    </>,
    anchorElem,
  );
}

function DraggableBlockMenu({
  editor,
  anchorElem,
}: {
  editor: LexicalEditor;
  anchorElem: HTMLElement;
}) {
  return useDraggableBlockMenu(editor, anchorElem, editor.isEditable());
}

/**
 * A handle beside the block under the mouse: drag it to move the block,
 * click it for the block's actions. Touch has those in the toolbar's Block
 * menu instead.
 */
export default function DraggableBlockPlugin({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const fine = useFinePointer();
  return fine ? (
    <DraggableBlockMenu editor={editor} anchorElem={anchorElem} />
  ) : null;
}
