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
        "relative z-0 bg-card rounded-lg",
        isOver &&
          !isDraggingItself &&
          "opacity-60 scale-[1.02] shadow-lg transition-all duration-150 ring-2 ring-primary ring-offset-2 ring-offset-background",
      )}
    >
      {children}
    </div>
  );
}
