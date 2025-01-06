"use client";

import { useDraggable } from "@dnd-kit/core";
import { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  type PointerEvent,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { cn } from "~/lib/utils";

import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  children: ReactNode;
};

export function Drag({ entity, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: entity.id,
    });
  const { onPointerDown, onKeyDown, ...otherListeners } =
    listeners as SyntheticListenerMap;

  /**
   * Disable drag if the active element is an input, textarea, select, button, or contenteditable element
   */
  const disableDrag = () => {
    const active = document.activeElement;
    return (
      active &&
      active.getAttribute("aria-roledescription") !== "draggable" && // if draggable, don't disable
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.tagName === "BUTTON" ||
        active.hasAttribute("contenteditable"))
    );
  };

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;

    if (disableDrag()) {
      return;
    }

    // don't intercept clicks on interactive elements
    if (
      target.closest(
        "button, a, input, select, textarea, [contenteditable], .interactive-only, [role=menuitem]",
      )
    ) {
      // let the click pass through
      return;
    }

    // otherwise, start the drag
    onPointerDown?.(e);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disableDrag()) {
      return;
    }

    onKeyDown?.(e);
  }

  const dragStyle: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
  };

  return (
    <div className="relative">
      {/* Ghost (shadow) element */}

      <div
        className={cn(
          "hidden relative opacity-0 inset-0 bg-muted pointer-events-none transition-opacity duration-500",
          isDragging && "block relative md:absolute opacity-30",
        )}
      >
        {children}
      </div>

      {/* Draggable element */}
      <div
        ref={setNodeRef}
        {...attributes}
        {...otherListeners}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        style={dragStyle}
        aria-describedby={undefined}
        className={cn(
          `relative cursor-grab`,
          isDragging && "absolute pointer-events-none z-[9999]",
        )}
      >
        {children}
      </div>
    </div>
  );
}
