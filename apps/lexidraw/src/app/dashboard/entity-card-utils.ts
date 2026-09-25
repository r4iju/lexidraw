import type { EntityType } from "@packages/types";
import type { RouterOutputs } from "~/trpc/shared";
import { entityHref } from "~/lib/entity-types";

export type Entity = RouterOutputs["entities"]["list"][number];

export type EntityCardBaseProps = {
  entity: Entity;
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
  /** On the first screen, so its picture loads straight away. */
  eager?: boolean;
};

export function buildSearchParams({
  flex,
  sortBy,
  sortOrder,
}: {
  flex?: "flex-row" | "flex-col";
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
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
