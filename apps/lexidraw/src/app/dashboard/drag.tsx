"use client";

import { useDraggable } from "@dnd-kit/core";
import { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import { type PointerEvent, type ReactNode, type KeyboardEvent } from "react";
import { cn } from "~/lib/utils";

import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  children: ReactNode;
  flex: "flex-row" | "flex-col";
};

export function Drag({ entity, children, flex }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entity.id,
    data: { entity, flex },
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

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...otherListeners}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative cursor-grab transition-opacity",
        // show it's "lifted"
        isDragging && "opacity-50",
      )}
      aria-describedby={undefined}
    >
      {children}
    </div>
  );
}
