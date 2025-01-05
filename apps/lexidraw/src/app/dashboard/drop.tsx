"use client";

import { useDndMonitor, useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

type Props = {
  parentId: string | null;
  disabled?: boolean;
  children: ReactNode;
  refetch: () => Promise<void>;
};

export function Drop({ parentId, disabled, children, refetch }: Props) {
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: parentId ?? "null",
    disabled: disabled,
  });

  const { mutate: updateEntity } = api.entities.update.useMutation();

  // Monitor global drag end (drop) to update parent ID
  useDndMonitor({
    onDragEnd: async (event) => {
      const { active, over } = event;
      if (!active || !over) return;
      if (active.id === over.id) return;
      const parentId = over.id === "null" ? null : (over.id as string);
      updateEntity({ id: active.id as string, parentId: parentId });
      await refetch();
    },
  });

  return (
    <div
      ref={setDroppableRef}
      className={cn(
        "relative z-0 bg-card",
        isOver && "opacity-50 transition-opacity duration-100",
      )}
    >
      {children}
    </div>
  );
}
