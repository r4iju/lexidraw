"use client";

import { useDraggable, type UniqueIdentifier } from "@dnd-kit/core";
import React, { type ReactNode } from "react";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/shared";

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
  // We rely on sensors in `dnd-context` for activation constraints, so
  // dragging should not start on simple clicks.

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
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
