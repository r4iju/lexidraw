"use client";

import { useDndMonitor } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { api } from "~/trpc/react";

type Props = {
  children: ReactNode;
  refetch: () => Promise<void>;
};

export function DndMonitor({ children, refetch }: Props) {
  const { mutate: updateEntity } = api.entities.update.useMutation();

  // Monitor global drag end (drop) to update parent ID
  useDndMonitor({
    onDragEnd: (event) => {
      const { active, over } = event;
      if (!active?.id || !over?.id) return;
      if (active.id === over.id) return;
      const parentId = over.id === "null" ? null : (over.id as string);
      updateEntity(
        { id: active.id as string, parentId },
        {
          onSuccess: () => {
            refetch();
          },
        },
      );
    },
  });

  return <>{children}</>;
}
