"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import type { ReactNode } from "react";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { EntityCard } from "./entity-card";
import { revalidateDashboard } from "./server-actions";

type Props = {
  children: ReactNode;
  flex: "flex-row" | "flex-col";
  sortBy: "updatedAt" | "createdAt" | "title";
  sortOrder: "asc" | "desc";
};

export default function Context({ children, flex, sortBy, sortOrder }: Props) {
  const [activeEntity, setActiveEntity] = useState<
    RouterOutputs["entities"]["list"][number] | null
  >(null);

  const utils = api.useUtils();

  const { mutate: updateEntity } = api.entities.update.useMutation({
    onMutate: async (movedEntity) => {
      // Cancel any ongoing fetches for the "list" query
      const queryKey = {
        parentId: movedEntity.parentId ?? null,
        sortBy,
        sortOrder,
      } as const;
      await utils.entities.list.cancel(queryKey);

      // Snapshot previous list for rollback
      const previousData = utils.entities.list.getData(queryKey) ?? [];

      // Optimistically update by removing the entity from the list
      utils.entities.list.setData(queryKey, (oldEntities) =>
        oldEntities
          ? oldEntities.filter((item) => item.id !== movedEntity.id)
          : [],
      );

      return { queryKey, previousData };
    },
    onError: (_error, _vars, context) => {
      // Rollback to previous data
      if (!context) return;
      utils.entities.list.setData(context.queryKey, context.previousData);
    },
    onSuccess: async (_res, _vars, context) => {
      // Invalidate the list query to refetch fresh data
      if (!context) return;
      utils.entities.list.invalidate(context.queryKey);
      await revalidateDashboard();
    },
  });

  const handleDragStart = (event: DragStartEvent) => {
    // The data for the dragged item is set in `useDraggable({ data: ... })`
    const { active } = event;
    const entity = active?.data?.current?.entity;
    if (entity) {
      setActiveEntity(entity);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (active?.id && over?.id && active.id !== over.id) {
      const parentId = over.id === "null" ? null : (over.id as string);
      updateEntity({ id: active.id as string, parentId });
    }

    setActiveEntity(null);
  };

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {children}

      {/* Overlay is rendered at the root level so it’s not constrained by layout */}
      <DragOverlay>
        {activeEntity ? (
          <EntityCard
            sortBy={sortBy}
            sortOrder={sortOrder}
            flex={flex}
            entity={activeEntity}
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
