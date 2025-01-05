"use client";

import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import type { PointerEvent, CSSProperties, ReactNode } from "react";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  children: ReactNode;
};

export function Drag({ entity, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
  } = useDraggable({ id: entity.id });

  // If you have an API mutation for re-parenting on drop:
  const { mutate: updateEntity } = api.entities.update.useMutation();

  // Monitor global drag end (drop) to update parent ID
  useDndMonitor({
    onDragEnd: (event) => {
      const { active, over } = event;
      if (!active || !over) return;
      if (active.id === over.id) return;
      updateEntity({ id: active.id as string, parentId: over.id as string });
    },
  });

  const { onPointerDown, ...otherListeners } =
    listeners as SyntheticListenerMap;

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;

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

  // basic drag styling
  const dragStyle: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
  };

  return (
    <div
      ref={setDraggableRef}
      {...attributes}
      {...otherListeners}
      onPointerDown={handlePointerDown}
      style={dragStyle}
      className={cn("relative z-0 cursor-grab", transform && "z-50 bg-card")}
    >
      {children}
    </div>
  );
}
