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

type Props = {
  children: ReactNode;
  flex: "flex-row" | "flex-col";
  sortBy: "updatedAt" | "createdAt" | "title";
};

export default function Context({ children, flex, sortBy }: Props) {
  const [activeEntity, setActiveEntity] = useState<
    RouterOutputs["entities"]["list"][number] | null
  >(null);

  const { mutate: updateEntity } = api.entities.update.useMutation();

  const handleDragStart = (event: DragStartEvent) => {
    // The data for the dragged item is set in `useDraggable({ data: ... })`
    const { active } = event;
    const entity = active?.data?.current?.entity;
    if (entity) {
      setActiveEntity(entity);
    }
    console.log("active entity", activeEntity);
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
            flex={flex}
            entity={activeEntity}
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
