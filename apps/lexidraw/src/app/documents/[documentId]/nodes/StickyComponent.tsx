import type { LexicalEditor, NodeKey } from "lexical";
import type { JSX } from "react";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { calculateZoomLevel } from "@lexical/utils";
import { $getNodeByKey } from "lexical";
import * as React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { StickyNode } from "./StickyNode";
import LexicalContentEditable from "~/components/ui/content-editable";
import { Button } from "~/components/ui/button";
import { PaintbrushIcon, TrashIcon } from "lucide-react";

type Positioning = {
  isDragging: boolean;
  offsetX: number;
  offsetY: number;
  rootElementRect: null | ClientRect;
  x: number;
  y: number;
};

export default function StickyComponent({
  x: propX,
  y: propY,
  nodeKey,
  color,
  caption,
}: {
  caption: LexicalEditor;
  color:
    | "pink"
    | "yellow"
    | "green"
    | "blue"
    | "red"
    | "orange"
    | "purple"
    | "gray";
  nodeKey: NodeKey;
  x: number;
  y: number;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const stickyContainerRef = useRef<null | HTMLDivElement>(null);
  const positioningRef = useRef<Positioning>({
    isDragging: false,
    offsetX: 0,
    offsetY: 0,
    rootElementRect: null,
    x: 0,
    y: 0,
  });

  const positionSticky = (): void => {
    const rootElementRect = positioningRef.current.rootElementRect;
    const rectLeft = rootElementRect !== null ? rootElementRect.left : 0;
    const rectTop = rootElementRect !== null ? rootElementRect.top : 0;
    if (stickyContainerRef.current) {
      stickyContainerRef.current.style.top =
        rectTop + positioningRef.current.y + "px";
      stickyContainerRef.current.style.left =
        rectLeft + positioningRef.current.x + "px";
    }
  };

  useEffect(() => {
    const xLocal = propX;
    const yLocal = propY;

    const position = positioningRef.current;
    position.x = xLocal;
    position.y = yLocal;

    const stickyContainer = stickyContainerRef.current;
    if (stickyContainer !== null) {
      positionSticky();
    }
  }, [propX, propY]);

  useLayoutEffect(() => {
    const position = positioningRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { target } = entry;
        position.rootElementRect = target.getBoundingClientRect();
        const stickyContainer = stickyContainerRef.current;
        if (stickyContainer !== null) {
          positionSticky();
        }
      }
    });

    const removeRootListener = editor.registerRootListener(
      (nextRootElem, prevRootElem) => {
        if (prevRootElem !== null) {
          resizeObserver.unobserve(prevRootElem);
        }
        if (nextRootElem !== null) {
          resizeObserver.observe(nextRootElem);
        }
      },
    );

    const handleWindowResize = () => {
      const rootElement = editor.getRootElement();
      const stickyContainer = stickyContainerRef.current;
      if (rootElement !== null && stickyContainer !== null) {
        position.rootElementRect = rootElement.getBoundingClientRect();
        positionSticky();
      }
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      removeRootListener();
    };
  }, [editor]);

  useEffect(() => {
    const stickyContainer = stickyContainerRef.current;
    if (stickyContainer !== null) {
      // Delay adding transition so we don't trigger the
      // transition on load of the sticky.
      setTimeout(() => {
        stickyContainer.style.setProperty(
          "transition",
          "top 0.3s ease 0s, left 0.3s ease 0s",
        );
      }, 500);
    }
  }, []);

  const handlePointerMove = (event: PointerEvent) => {
    const stickyContainer = stickyContainerRef.current;
    const positioning = positioningRef.current;
    const rootElementRect = positioning.rootElementRect;
    const zoom = calculateZoomLevel(stickyContainer);
    if (
      stickyContainer !== null &&
      positioning.isDragging &&
      rootElementRect !== null
    ) {
      positioning.x =
        event.pageX / zoom - positioning.offsetX - rootElementRect.left;
      positioning.y =
        event.pageY / zoom - positioning.offsetY - rootElementRect.top;
      positionSticky();
    }
  };

  const handlePointerUp = () => {
    const stickyContainer = stickyContainerRef.current;
    const positioning = positioningRef.current;
    if (stickyContainer !== null) {
      positioning.isDragging = false;
      stickyContainer.classList.remove("dragging");
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (StickyNode.$isStickyNode(node)) {
          node.setPosition(positioning.x, positioning.y);
        }
      });
    }
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
  };

  const handleDelete = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (StickyNode.$isStickyNode(node)) {
        node.remove();
      }
    });
  };

  const handleColorChange = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (StickyNode.$isStickyNode(node)) {
        node.toggleColor();
      }
    });
  };

  const colorClasses = {
    pink: "bg-pink-300",
    yellow: "bg-yellow-300",
    green: "bg-green-300",
    blue: "bg-blue-300",
    red: "bg-red-300",
    orange: "bg-orange-300",
    purple: "bg-purple-300",
    gray: "bg-gray-300",
  } as const;

  const contentEditableTwClasses =
    "min-h-[20px] border-0 resize-none cursor-text text-2xl caret-[#050505] block relative outline-none p-0 select-text whitespace-pre-wrap break-words w-full box-border";
  const placeholderTwClasses =
    "text-2xl text-neutral-400 overflow-hidden absolute text-ellipsis top-[30px] left-[20px] w-[120px] select-none whitespace-nowrap inline-block pointer-events-none";

  return (
    <div ref={stickyContainerRef} className="sticky-note-container absolute">
      <div
        className={`block w-48 h-48 p-1 border border-border shadow-lg relative ${colorClasses[color]}`}
        onPointerDown={(event) => {
          const stickyContainer = stickyContainerRef.current;
          if (
            stickyContainer == null ||
            event.button === 2 ||
            event.target !== stickyContainer.firstChild
          ) {
            // Right click or click on editor should not work
            return;
          }
          const stickContainer = stickyContainer;
          const positioning = positioningRef.current;
          if (stickContainer !== null) {
            const { top, left } = stickContainer.getBoundingClientRect();
            const zoom = calculateZoomLevel(stickContainer);
            positioning.offsetX = event.clientX / zoom - left;
            positioning.offsetY = event.clientY / zoom - top;
            positioning.isDragging = true;
            stickContainer.classList.add("dragging");
            document.addEventListener("pointermove", handlePointerMove);
            document.addEventListener("pointerup", handlePointerUp);
            event.preventDefault();
          }
        }}
      >
        <div className="flex items-center justify-between gap-2 p-0">
          <Button
            onClick={handleColorChange}
            variant="ghost"
            size="icon"
            aria-label="Change sticky note color"
            title="Color"
          >
            <PaintbrushIcon className="size-4" />
          </Button>
          <Button
            onClick={handleDelete}
            size="icon"
            variant="ghost"
            aria-label="Delete sticky note"
            title="Delete"
          >
            <TrashIcon className="size-4" />
          </Button>
        </div>
        <div className="px-2">
          <LexicalNestedComposer initialEditor={caption}>
            <PlainTextPlugin
              contentEditable={
                <LexicalContentEditable
                  placeholder="What's up?"
                  placeholderClassName={placeholderTwClasses}
                  className={contentEditableTwClasses}
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </LexicalNestedComposer>
        </div>
      </div>
    </div>
  );
}
