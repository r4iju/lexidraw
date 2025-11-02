"use client";

import Link from "next/link";
import type { EntityType } from "@packages/types";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { MoreActions } from "./_actions/more-actions";
import { ThumbnailClient } from "./thumbnail-client";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { TagTooltip } from "./entity-card-tag-tooltip";
import {
  type EntityCardBaseProps,
  buildSearchParams,
  formatEntityDate,
  getItemUrl,
} from "./entity-card-utils";

type Props = EntityCardBaseProps & {
  flex?: "flex-row" | "flex-col";
};

export function EntityCardCol({
  entity,
  sortBy = "updatedAt",
  sortOrder = "desc",
  isOverlay = false,
  flex = "flex-col",
}: Props) {
  const searchParams = buildSearchParams({ flex, sortBy, sortOrder });
  const { updatedOrCreated, dateString } = formatEntityDate(entity, sortBy);

  return (
    <Card
      id={`entity-${entity.id}`}
      className={cn(
        "relative grid grid-cols-[auto_1fr_auto] gap-4 rounded-lg p-0 items-center",
        isOverlay && "cursor-grabbing bg-card bg-opacity-100",
      )}
      style={{
        ...(isOverlay && {
          transform: "translate3d(0, 0, 0)",
        }),
      }}
    >
      {entity.archivedAt && (
        <span className="absolute right-2 top-2 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Archived
        </span>
      )}

      {/* thumbnail column */}
      <div className="h-18.5 aspect-4/3 shrink-0 overflow-hidden rounded-none">
        <Link
          href={getItemUrl({
            id: entity.id,
            entityType: entity.entityType as EntityType,
            searchParams,
          })}
          className="block size-full"
          draggable={false}
        >
          <ThumbnailClient entity={entity} size="small" />
        </Link>
      </div>

      {/* title column - flexible */}
      <Link
        href={getItemUrl({
          id: entity.id,
          entityType: entity.entityType as EntityType,
          searchParams,
        })}
        className="min-w-0"
      >
        <span className="font-semibold line-clamp-2 select-none">
          {entity.title}
        </span>
      </Link>

      {/* date + actions column - fixed width */}
      <div className="flex justify-between items-center gap-4 px-4 py-4 max-w-[250px]">
        <Link
          href={getItemUrl({
            id: entity.id,
            entityType: entity.entityType as EntityType,
            searchParams,
          })}
          className="hidden md:block"
        >
          <span
            className={cn("text-sm text-muted-foreground", {
              "line-clamp-2 max-w-24": flex === "flex-col",
            })}
          >
            {/* Avoid text selection during drag */}
            {updatedOrCreated}
            {dateString}
          </span>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <TagTooltip entity={entity} className="hidden md:flex" />

          {!isOverlay ? (
            <MoreActions entity={entity} currentAccess={entity.publicAccess} />
          ) : (
            <Button size="icon" variant="ghost" disabled>
              <DotsHorizontalIcon className="size-5" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
