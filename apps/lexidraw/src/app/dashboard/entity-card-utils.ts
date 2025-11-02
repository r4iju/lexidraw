import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import type { EntityType } from "@packages/types";
import type { RouterOutputs } from "~/trpc/shared";

export type Entity = RouterOutputs["entities"]["list"][number];

export type EntityCardBaseProps = {
  entity: Entity;
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
  isOverlay?: boolean;
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

export function formatEntityDate(
  entity: Entity,
  sortBy: "updatedAt" | "createdAt" | "title" = "updatedAt",
) {
  const updatedOrCreated = sortBy === "createdAt" ? "Created " : "Updated ";
  const dateString = formatDistanceToNow(
    new Date(sortBy === "createdAt" ? entity.createdAt : entity.updatedAt),
    { addSuffix: true },
  );
  return { updatedOrCreated, dateString };
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
  const t = String(entityType || "").toLowerCase();
  switch (t) {
    case "directory":
      return `/dashboard/${id}?${searchParams.toString()}`;
    case "drawing":
      return `/drawings/${id}`;
    case "document":
      return `/documents/${id}`;
    case "url":
      return `/urls/${id}`;
    default:
      console.warn(`Unknown entity type: ${t}`);
      return `/urls/${id}`;
  }
}
