"use client";

import { useDndContext, useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { type EntityAccess, mayDrop } from "~/lib/entity-access";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/shared";

/** Where a drop goes: a folder, with the viewer's access to it, or null for Home. */
export type DropFolder = { id: string; access: EntityAccess } | null;

type Props = {
  folder: DropFolder;
  disabled?: boolean;
  children: ReactNode;
};

/** What `Drag` puts on the file being dragged, for a target to judge. */
export const draggedEntity = (data: unknown) =>
  (data as { entity?: RouterOutputs["entities"]["list"][number] } | undefined)
    ?.entity;

/**
 * A target for a dragged file. It takes only the files the server would let
 * the viewer move there, and shows nothing for the rest.
 */
export function Drop({ folder, disabled, children }: Props) {
  const { active } = useDndContext();
  const dragged = draggedEntity(active?.data.current);
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: folder?.id ?? "null",
    data: { folder },
    disabled: disabled || (dragged !== undefined && !mayDrop(dragged, folder)),
  });

  const isDraggingItself = active?.id === folder?.id;

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
