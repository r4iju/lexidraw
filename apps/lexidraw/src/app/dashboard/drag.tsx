"use client";

import { useDraggable, type UniqueIdentifier } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { may } from "~/lib/entity-access";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/shared";

type DragProps = {
  entity: RouterOutputs["entities"]["list"][number];
  children: ReactNode;
};

export function Drag({ entity, children }: DragProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entity.id as UniqueIdentifier,
    data: { entity },
    disabled: !may(entity.access, "move"),
  });
  // We rely on sensors in `dnd-context` for activation constraints, so
  // dragging should not start on simple clicks.

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: `attributes` spreads dnd-kit's role="button" and tabIndex, which the rule cannot see.
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "relative cursor-grab transition-opacity",
        isDragging && "opacity-50",
      )}
      aria-describedby={undefined}
      // What dragging does, rather than a name read from the whole card.
      aria-label={`Move ${entity.title}`}
    >
      {children}
    </div>
  );
}
