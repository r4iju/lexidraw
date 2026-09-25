"use client";

import { useDndContext, useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type Props = {
  parentId: string | null;
  disabled?: boolean;
  children: ReactNode;
};

export function Drop({ parentId, disabled, children }: Props) {
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: parentId ?? "null",
    disabled: disabled,
  });

  const { active } = useDndContext();
  const isDraggingItself = active?.id === parentId;

  return (
    <div
      ref={setDroppableRef}
      className={cn(
        "relative z-0 rounded-lg bg-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-primary/10 after:opacity-0 after:transition-opacity",
        isOver &&
          !isDraggingItself &&
          "ring-2 ring-primary ring-offset-2 ring-offset-background after:opacity-100",
      )}
    >
      {children}
    </div>
  );
}
