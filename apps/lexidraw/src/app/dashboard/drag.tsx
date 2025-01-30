"use client";

import { useDraggable, type UniqueIdentifier } from "@dnd-kit/core";
import { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import React, {
  useCallback,
  useRef,
  PointerEvent,
  KeyboardEvent,
  ReactNode,
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

  const pointerState = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    dragging: boolean;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    dragging: false,
    timeoutId: null,
  });

  const disableDrag = useCallback(() => {
    const active = document.activeElement;
    return (
      !!active &&
      active.getAttribute("aria-roledescription") !== "draggable" &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.tagName === "BUTTON" ||
        active.hasAttribute("contenteditable"))
    );
  }, []);

  /** cancel any pending drag if we move or release the pointer before meeting time/distance thresholds. */
  const cancelPendingDrag = useCallback(() => {
    const ps = pointerState.current;
    if (ps.timeoutId) clearTimeout(ps.timeoutId);
    ps.timeoutId = null;
    ps.dragging = false;
    ps.pointerId = null;
  }, []);

  /** manually invoke the underlying `onPointerDown` from dnd-kit once we decide the drag should really start. */
  const startDrag = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (disableDrag()) return;

      // mark as officially dragging
      pointerState.current.dragging = true;
      // call dnd-kit’s internal pointer-down handler
      onPointerDown?.(e);
    },
    [disableDrag, onPointerDown],
  );

  /** won't call `startDrag` until thresholds are met. */
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (disableDrag()) return;

      // ignore pointerDown on interactive elements
      if (
        target.closest(
          "button, a, input, select, textarea, [contenteditable], .interactive-only, [role=menuitem]",
        )
      ) {
        return;
      }

      // capture this pointer so we don't handle multi-touch incorrectly
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      // store initial pointer details
      pointerState.current.pointerId = e.pointerId;
      pointerState.current.startX = e.clientX;
      pointerState.current.startY = e.clientY;
      pointerState.current.dragging = false;

      // use a time threshold
      pointerState.current.timeoutId = setTimeout(() => {
        // If user hasn't moved beyond a distance threshold, start drag
        if (!pointerState.current.dragging) {
          startDrag(e);
        }
      }, 100);
    },
    [disableDrag, startDrag],
  );

  /** cancel any pending drag if the user moves outside a small threshold typically used to detect scrolling vs. drag. */
  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const ps = pointerState.current;

      // Only handle if it’s the same pointer
      if (ps.pointerId !== e.pointerId) return;

      const dx = Math.abs(e.clientX - ps.startX);
      const dy = Math.abs(e.clientY - ps.startY);
      const distanceThreshold = 5; // px

      // passed threshold and haven't yet started dragging:
      if (!ps.dragging && (dx > distanceThreshold || dy > distanceThreshold)) {
        // cancel the pending time-based drag
        if (ps.timeoutId) clearTimeout(ps.timeoutId);
        ps.timeoutId = null;
        // could start drag immediately here:
        // startDrag(e);
        // or treat large movement as scrolling => do NOT start drag:
        cancelPendingDrag();
      }
    },
    [cancelPendingDrag],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const ps = pointerState.current;
      if (ps.pointerId !== e.pointerId) return;

      // cleanup
      cancelPendingDrag();
      // release pointer capture
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    },
    [cancelPendingDrag],
  );

  /** handle pointercancel (e.g., if the OS cancels the gesture) or performs a 2-finger gestures  */
  const handlePointerCancel = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (pointerState.current.pointerId === e.pointerId) {
        cancelPendingDrag();
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
    },
    [cancelPendingDrag],
  );

  /** cancel drag attempts for ESC or any keyboard-based approach conflicts. */
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disableDrag()) return;
    onKeyDown?.(e);
  }

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...otherListeners}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative cursor-grab transition-opacity touch-manipulation",
        isDragging && "opacity-50",
      )}
      aria-describedby={undefined}
    >
      {children}
    </div>
  );
}
