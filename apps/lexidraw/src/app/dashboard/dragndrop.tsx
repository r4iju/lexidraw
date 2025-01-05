"use client";

import { useDndMonitor, useDraggable, useDroppable } from "@dnd-kit/core";
import type { CSSProperties, ReactNode } from "react";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";

type Props = {
  entity: RouterOutputs["entities"]["list"][number];
  children: ReactNode;
};

export function DragAndDrop({ entity, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
  } = useDraggable({ id: entity.id });
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: entity.id,
    disabled: entity.entityType !== "directory",
  });

  const { mutate } = api.entities.update.useMutation();

  useDndMonitor({
    onDragEnd: (event) => {
      const { active, over } = event;
      if (!active || !over) return;
      if (active.id === over.id) return;
      mutate({
        id: active.id as string,
        parentId: over.id as string,
      });
    },
  });

  const dragStyle = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: transform ? 1000 : "auto", // lift on drag
    opacity: isOver ? 0.7 : 1, // highlight when droppable
    cursor: "grab",
    pointerEvents: transform ? "none" : "auto", // disable pointer events on drag
  } satisfies CSSProperties;

  return (
    <div
      ref={setDroppableRef}
      style={{ position: "relative" } satisfies CSSProperties}
    >
      {" "}
      <div
        ref={setDraggableRef}
        {...listeners}
        {...attributes}
        style={dragStyle}
      >
        {children}
      </div>
    </div>
  );
}
