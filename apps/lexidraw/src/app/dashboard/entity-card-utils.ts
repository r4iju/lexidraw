import type { EntityType } from "@packages/types";
import type { RouterOutputs } from "~/trpc/shared";
import { entityHref } from "~/lib/entity-types";
import type { DashboardQuery } from "./dashboard-query";

export type Entity = RouterOutputs["entities"]["list"][number];

export type EntityCardBaseProps = {
  entity: Entity;
  sortBy?: DashboardQuery["sortBy"];
  sortOrder?: DashboardQuery["sortOrder"];
  /** On the first screen, so its picture loads straight away. */
  eager?: boolean;
};

export function buildSearchParams({
  flex,
  sortBy,
  sortOrder,
}: {
  flex?: DashboardQuery["flex"];
  sortBy?: DashboardQuery["sortBy"];
  sortOrder?: DashboardQuery["sortOrder"];
}) {
  return new URLSearchParams({
    ...(flex ? { flex } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortOrder ? { sortOrder } : {}),
  });
}

export function getItemUrl({
  id,
  entityType,
  searchParams,
}: {
  id: string;
  entityType: EntityType | string;
  searchParams: URLSearchParams;
}) {
  const href = entityHref(entityType, id);
  // A folder is Home filtered to it, so it keeps the view the reader is in.
  return entityType === "directory"
    ? `${href}?${searchParams.toString()}`
    : href;
}
