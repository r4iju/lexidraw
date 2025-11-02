"use client";

import type { RouterOutputs } from "~/trpc/shared";
import { EntityCardRow } from "./entity-card-row";
import { EntityCardCol } from "./entity-card-col";

type Entity = RouterOutputs["entities"]["list"][number];

type Props = {
  entity: Entity;
  flex: "flex-row" | "flex-col";
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
  isOverlay?: boolean;
};

export function EntityCard({
  entity,
  flex,
  sortBy = "updatedAt",
  sortOrder = "desc",
  isOverlay = false,
}: Props) {
  if (flex === "flex-row") {
    return (
      <EntityCardRow
        entity={entity}
        flex={flex}
        sortBy={sortBy}
        sortOrder={sortOrder}
        isOverlay={isOverlay}
      />
    );
  }

  return (
    <EntityCardCol
      entity={entity}
      flex={flex}
      sortBy={sortBy}
      sortOrder={sortOrder}
      isOverlay={isOverlay}
    />
  );
}
