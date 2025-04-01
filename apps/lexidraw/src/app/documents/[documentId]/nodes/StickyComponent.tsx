/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { LexicalEditor, NodeKey } from "lexical";
import type { JSX } from "react";

import "./StickyNode.css";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { calculateZoomLevel } from "@lexical/utils";
import { $getNodeByKey } from "lexical";
import * as React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import StickyEditorTheme from "../themes/sticky-editor-theme";

import { $isStickyNode } from "./StickyNode";
import LexicalContentEditable from "~/components/ui/content-editable";

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
  color: "pink" | "yellow";
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
        if ($isStickyNode(node)) {
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
      if ($isStickyNode(node)) {
        node.remove();
      }
    });
  };

  const handleColorChange = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isStickyNode(node)) {
        node.toggleColor();
      }
    });
  };

  return (
    <div ref={stickyContainerRef} className="sticky-note-container">
      <div
        className={`sticky-note ${color}`}
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
        <button
          onClick={handleDelete}
          className="delete"
          aria-label="Delete sticky note"
          title="Delete"
        >
          X
        </button>
        <button
          onClick={handleColorChange}
          className="color"
          aria-label="Change sticky note color"
          title="Color"
        >
          <i className="bucket" />
        </button>
        <LexicalNestedComposer
          initialEditor={caption}
          initialTheme={StickyEditorTheme}
        >
          <PlainTextPlugin
            contentEditable={
              <LexicalContentEditable
                placeholder="What's up?"
                placeholderClassName="StickyNode__placeholder"
                className="StickyNode__contentEditable"
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </LexicalNestedComposer>
      </div>
    </div>
  );
}
