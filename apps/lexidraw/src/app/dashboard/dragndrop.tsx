"use client";

import { useDndMonitor, useDraggable, useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
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

  // Apply transform styles for draggable movement
  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    zIndex: transform ? 1000 : "auto", // Lift on drag
    opacity: isOver ? 0.7 : 1, // Highlight when droppable
  };

  return (
    <div ref={setDroppableRef} style={{ position: "relative" }}>
      <div ref={setDraggableRef} {...listeners} {...attributes} style={style}>
        {children}
      </div>
    </div>
  );
}
