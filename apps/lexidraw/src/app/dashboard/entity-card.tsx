"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { EntityType } from "@packages/types";
import type { RouterOutputs } from "~/trpc/shared";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { MoreActions } from "./_actions/more-actions";
import { ThumbnailClient } from "./thumbnail-client";
import EntityTitle from "./_actions/rename-inline";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { TagTooltip } from "./entity-card-tag-tooltip";

type Entity = RouterOutputs["entities"]["list"][number];

type Props = {
  entity: Entity;
  flex: "flex-row" | "flex-col";
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
  isOverlay?: boolean;
  llmConfig?: RouterOutputs["auth"]["getLlmConfig"];
};

export function EntityCard({
  entity,
  flex,
  sortBy = "updatedAt",
  sortOrder = "desc",
  isOverlay = false,
  llmConfig,
}: Props) {
  const searchParams = new URLSearchParams({
    ...(flex ? { flex } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortOrder ? { sortOrder } : {}),
  });
  const updatedOrCreated = sortBy === "createdAt" ? "Created " : "Updated ";
  const dateString = formatDistanceToNow(
    new Date(sortBy === "createdAt" ? entity.createdAt : entity.updatedAt),
    { addSuffix: true },
  );

  const itemUrl = ({
    id,
    entityType,
    searchParams,
  }: {
    id: string;
    entityType: EntityType;
    searchParams: URLSearchParams;
  }) => {
    switch (entityType) {
      case EntityType.DIRECTORY:
        return `/dashboard/${id}?${searchParams.toString()}`;
      case EntityType.DRAWING:
        return `/drawings/${id}`;
      case EntityType.DOCUMENT:
        return `/documents/${id}`;
      default:
        console.warn(`Unknown entity type: ${entityType satisfies never}`);
        return `/dashboard/${id}?${searchParams.toString()}`;
    }
  };

  return (
    <Card
      id={`entity-${entity.id}`}
      className={cn(
        "relative flex gap-4 rounded-lg p-4 justify-between",
        // "hover:bg-muted/20 transition-colors duration-150",
        flex === "flex-row" && "flex-col",
        flex === "flex-col" && "flex-row",
        isOverlay && "cursor-grabbing bg-card bg-opacity-100",
      )}
      style={{
        ...(isOverlay && {
          transform: "translate3d(0, 0, 0)",
        }),
      }}
    >
      {/* left side */}
      <div
        className={cn(
          "flex flex-row items-center gap-4",
          flex === "flex-row" && "hidden",
        )}
      >
        <div className="size-10 min-w-10">
          <Link
            href={itemUrl({
              id: entity.id,
              entityType: entity.entityType as EntityType,
              searchParams,
            })}
            className="block size-full"
            draggable={false}
          >
            <ThumbnailClient entity={entity} />
          </Link>
        </div>
        <Link
          href={itemUrl({
            id: entity.id,
            entityType: entity.entityType as EntityType,
            searchParams,
          })}
        >
          <span className="font-semibold line-clamp-1 w-full select-none">
            {entity.title}
          </span>
        </Link>
      </div>

      {/* middle: date + actions */}
      <div className="flex justify-between items-center">
        <Link
          href={itemUrl({
            id: entity.id,
            entityType: entity.entityType as EntityType,
            searchParams,
          })}
        >
          <span
            className={cn(
              "text-sm text-muted-foreground",
              flex === "flex-row" ? "block" : "hidden md:block",
            )}
          >
            {/* Avoid text selection during drag */}
            {updatedOrCreated}
            {dateString}
          </span>
        </Link>

        <div className="flex items-center">
          <TagTooltip entity={entity} className="hidden md:flex" />

          {!isOverlay ? (
            <MoreActions
              entity={entity}
              currentAccess={entity.publicAccess}
              llmConfig={llmConfig}
            />
          ) : (
            <Button size="icon" variant="ghost" disabled>
              <DotsHorizontalIcon className="size-5" />
            </Button>
          )}
        </div>
      </div>

      {/* right side (if flex-row) */}
      <div
        className={cn(
          "items-center gap-4",
          flex === "flex-row" ? "flex flex-col" : "hidden",
        )}
      >
        <EntityTitle entity={entity} />
        <Link
          href={itemUrl({
            id: entity.id,
            entityType: entity.entityType as EntityType,
            searchParams,
          })}
          className="block w-full"
          style={{ aspectRatio: "4 / 3" }}
          draggable={false}
        >
          <ThumbnailClient entity={entity} />
        </Link>
      </div>

      {/* "open" button if flex-row */}
      {flex === "flex-row" && (
        <Button className="mt-2 w-full" asChild>
          <Link
            href={itemUrl({
              id: entity.id,
              entityType: entity.entityType as EntityType,
              searchParams,
            })}
          >
            {entity.entityType === "directory" ? "Open folder" : "Open"}
          </Link>
        </Button>
      )}
    </Card>
  );
}
