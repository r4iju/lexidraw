"use client";

import { useCallback, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  pointerWithin,
} from "@dnd-kit/core";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { besidePointer } from "./beside-pointer";
import { revalidateDashboard } from "./server-actions";
import { EntityThumbnail } from "./thumbnail-client";

type Entity = RouterOutputs["entities"]["list"][number];

type Props = {
  children: React.ReactNode;
  sortBy: "updatedAt" | "createdAt" | "title";
  sortOrder: "asc" | "desc";
};

/** The ghost's size until it has been measured: its widest, and its height. */
const CHIP_ESTIMATE = { width: 256, height: 48 };

export function DraggingContext({ children, sortBy, sortOrder }: Props) {
  const [activeEntity, setActiveEntity] = useState<Entity | null>(null);
  const [chip, setChip] = useState(CHIP_ESTIMATE);
  const measureChip = useCallback(
    (size: { width: number; height: number }) =>
      setChip((known) =>
        known.width === size.width && known.height === size.height
          ? known
          : size,
      ),
    [],
  );

  const utils = api.useUtils();

  // Configure sensors: require small movement for mouse; short long-press for touch
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  const { mutate: updateEntity } = api.entities.update.useMutation({
    onMutate: async (vars) => {
      const element = document.getElementById(`entity-${vars.id}`);
      if (!element) return;
      element.classList.add("hidden");

      const { id, parentId: newParentId, prevParentId: oldParentId } = vars;

      // 1) Create React Query keys for both the old and new parent
      const oldParentKey = {
        parentId: oldParentId ?? undefined,
        sortBy,
        sortOrder,
      } as const;
      const newParentKey = {
        parentId: newParentId ?? undefined,
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

      const moved = oldParentData.find((e) => e.id === id) ?? activeEntity;
      utils.entities.list.setData(newParentKey, (current) => {
        if (!current) return [];
        if (!moved) return current;
        return [...current, { ...moved, parentId: newParentId ?? null }];
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
      const parentId = over.id === "null" ? null : String(over.id);
      updateEntity({
        id: String(active.id),
        parentId,
        prevParentId: active.data.current?.entity.parentId,
      });
    }

    setActiveEntity(null);
  };

  return (
    <DndContext
      sensors={sensors}
      // The target is what the pointer is over, not what the ghost beside it
      // overlaps.
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {children}

      {/* Overlay is rendered at the root level so it’s not constrained by layout */}
      <DragOverlay modifiers={[besidePointer(chip)]}>
        {activeEntity ? (
          <DragChip entity={activeEntity} onMeasured={measureChip} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * What is being dragged, as small as it can say so: its picture and name,
 * whether it is a list row or a grid card, so the target stays in sight.
 */
function DragChip({
  entity,
  onMeasured,
}: {
  entity: Entity;
  onMeasured: (size: { width: number; height: number }) => void;
}) {
  return (
    <div
      ref={(node) => {
        if (node)
          onMeasured({ width: node.offsetWidth, height: node.offsetHeight });
      }}
      className="flex h-12 w-max max-w-64 cursor-grabbing items-center gap-2.5 rounded-lg border border-border bg-popover py-1 pr-3.5 pl-1 text-popover-foreground shadow-lg"
    >
      <EntityThumbnail entity={entity} variant="row" />
      <span className="truncate text-row font-medium select-none">
        {entity.title}
      </span>
    </div>
  );
}
