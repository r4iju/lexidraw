"use client";

import { useDraggable, type UniqueIdentifier } from "@dnd-kit/core";
import { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import React, {
  useCallback,
  useRef,
  PointerEvent,
  KeyboardEvent,
  ReactNode,
  useEffect,
} from "react";
import { cn } from "~/lib/utils";
import { RouterOutputs } from "~/trpc/shared";

type DragProps = {
  entity: RouterOutputs["entities"]["list"][number];
  children: ReactNode;
  flex: "flex-row" | "flex-col";
};

export function Drag({ entity, children, flex }: DragProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entity.id as UniqueIdentifier,
    data: { entity, flex },
  });
  const { onPointerDown, onKeyDown, ...otherListeners } =
    (listeners as SyntheticListenerMap) || {};

  const pointerState = useRef({
    pointerId: 0,
    startX: 0,
    startY: 0,
    dragging: false,
    timeoutId: 0 as unknown as ReturnType<typeof setTimeout>,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);

  const disableDrag = useCallback(() => {
    const el = document.activeElement;
    return (
      (el &&
        el.getAttribute("aria-roledescription") !== "draggable" &&
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName)) ||
      el?.hasAttribute("contenteditable")
    );
  }, []);

  const cancelDrag = useCallback(() => {
    const ps = pointerState.current;
    clearTimeout(ps.timeoutId);
    ps.dragging = false;
    ps.pointerId = 0;
    if (containerRef.current) {
      containerRef.current.classList.remove("touch-none");
    }
  }, []);

  /** manually invoke the underlying `onPointerDown` from dnd-kit once we decide the drag should really start. */
  const startDrag = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (disableDrag()) return;
      pointerState.current.dragging = true;
      if (containerRef.current) {
        containerRef.current.classList.add("touch-none");
      }
      onPointerDown?.(e);
    },
    [disableDrag, onPointerDown],
  );

  /** won't call `startDrag` until thresholds are met. */
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (disableDrag()) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(
          "button, a, input, select, textarea, [contenteditable], .interactive-only, [role=menuitem]",
        )
      ) {
        return;
      }
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const ps = pointerState.current;
      ps.pointerId = e.pointerId;
      ps.startX = e.clientX;
      ps.startY = e.clientY;
      ps.dragging = false;
      ps.timeoutId = setTimeout(() => {
        if (!ps.dragging) startDrag(e);
      }, 120);
    },
    [disableDrag, startDrag],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const ps = pointerState.current;
      if (ps.pointerId !== e.pointerId) return;
      if (ps.dragging) {
        // prevent scrolling once dragging
        e.preventDefault();
        return;
      }
      const dx = Math.abs(e.clientX - ps.startX);
      const dy = Math.abs(e.clientY - ps.startY);
      if (dx > 5 || dy > 5) cancelDrag();
    },
    [cancelDrag],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerState.current.pointerId === e.pointerId) {
        cancelDrag();
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
    },
    [cancelDrag],
  );

  /** handle pointercancel (e.g., if the OS cancels the gesture) or performs a 2-finger gestures  */
  const handlePointerCancel = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerState.current.pointerId === e.pointerId) {
        cancelDrag();
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
    },
    [cancelDrag],
  );

  /** cancel drag attempts for ESC or any keyboard-based approach conflicts. */
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disableDrag()) return;
    onKeyDown?.(e);
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const opts = { passive: false } as AddEventListenerOptions;
    const moveListener = (ev: TouchEvent) => {
      if (pointerState.current.dragging) ev.preventDefault();
    };
    el.addEventListener("touchmove", moveListener, opts);
    return () => el.removeEventListener("touchmove", moveListener, opts);
  }, []);

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        containerRef.current = node;
      }}
      {...attributes}
      {...otherListeners}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative cursor-grab transition-opacity",
        isDragging && "opacity-50",
      )}
      aria-describedby={undefined}
    >
      {children}
    </div>
  );
}
