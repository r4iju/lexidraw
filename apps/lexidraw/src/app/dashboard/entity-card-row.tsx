"use client";

import Link from "next/link";
import type { EntityType } from "@packages/types";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { MoreActions } from "./_actions/more-actions";
import { ThumbnailClient } from "./thumbnail-client";
import EntityTitle from "./_actions/rename-inline";
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

export function EntityCardRow({
  entity,
  sortBy = "updatedAt",
  sortOrder = "desc",
  isOverlay = false,
  flex = "flex-row",
}: Props) {
  const searchParams = buildSearchParams({ flex, sortBy, sortOrder });
  const { updatedOrCreated, dateString } = formatEntityDate(entity, sortBy);

  return (
    <Card
      id={`entity-${entity.id}`}
      className={cn(
        "relative flex flex-col gap-4 rounded-lg p-4 justify-between",
        isOverlay && "cursor-grabbing bg-card bg-opacity-100",
      )}
      style={{
        ...(isOverlay && {
          transform: "translate3d(0, 0, 0)",
        }),
      }}
    >
      {entity.archivedAt && (
        <span className="absolute right-6 top-6 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Archived
        </span>
      )}

      {/* middle: date + actions */}
      <div className="flex justify-between items-center">
        <Link
          href={getItemUrl({
            id: entity.id,
            entityType: entity.entityType as EntityType,
            searchParams,
          })}
        >
          <span className="text-sm text-muted-foreground line-clamp-2 ">
            {/* Avoid text selection during drag */}
            {updatedOrCreated}
            {dateString}
          </span>
        </Link>

        <div className="flex items-center">
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

      {/* right side */}
      <div className="flex flex-col items-center gap-4">
        <div className="w-full">
          <EntityTitle entity={entity} />
        </div>
        <Link
          href={getItemUrl({
            id: entity.id,
            entityType: entity.entityType as EntityType,
            searchParams,
          })}
          className={cn(
            "block w-full aspect-4/3 overflow-hidden",
            flex === "flex-col" ? "rounded-l-lg rounded-r-none" : "rounded-lg",
          )}
          draggable={false}
        >
          <ThumbnailClient
            entity={entity}
            roundedCorners={flex === "flex-col" ? "left-only" : "all"}
          />
        </Link>
      </div>
    </Card>
  );
}
