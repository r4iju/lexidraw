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
    onMutate: async (vars) => {
      const element = document.getElementById(`entity-${vars.id}`);
      if (!element) return;
      element.classList.add("hidden");

      const { id, parentId: newParentId, prevParentId: oldParentId } = vars;

      // 1) Create React Query keys for both the old and new parent
      const oldParentKey = {
        parentId: oldParentId ?? null,
        sortBy,
        sortOrder,
      } as const;
      const newParentKey = {
        parentId: newParentId ?? null,
        sortBy,
        sortOrder,
      } as const;

      await utils.entities.list.cancel(oldParentKey);
      await utils.entities.list.cancel(newParentKey);

      const oldParentData = utils.entities.list.getData(oldParentKey) ?? [];
      const newParentData = utils.entities.list.getData(newParentKey) ?? [];

      utils.entities.list.setData(oldParentKey, (current) =>
        current ? current.filter((e) => e.id !== id) : [],
      );

      utils.entities.list.setData(newParentKey, (current) => {
        if (!current) return [];
        // If you have the full entity object somewhere, use that
        // or minimally:
        const movedEntity = {
          ...(activeEntity as RouterOutputs["entities"]["list"][number]),
          id: id as string,
          parentId: newParentId as string | null,
        };
        return [...current, movedEntity];
      });

      return {
        oldParentKey,
        newParentKey,
        oldParentData,
        newParentData,
      };
    },
    onError: (_error, vars, context) => {
      console.log("rollback to previous data");
      if (!context) return;
      const element = document.getElementById(`entity-${vars.id}`);
      if (!element) return;
      element.classList.remove("hidden");

      utils.entities.list.setData(context.oldParentKey, context.oldParentData);
      utils.entities.list.setData(context.newParentKey, context.newParentData);
    },
    onSuccess: async (_res, _vars, context) => {
      if (!context) return;
      await utils.entities.list.invalidate(context.oldParentKey);
      await utils.entities.list.invalidate(context.newParentKey);

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
      updateEntity({
        id: active.id as string,
        parentId,
        prevParentId: active.data.current?.entity.parentId,
      });
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
