"use client";

import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { EntityTypeIcon, entityTypeLabel } from "~/lib/entity-types";
import { cn } from "~/lib/utils";
import { MoreActions } from "./_actions/more-actions";
import { EntityTime } from "./entity-card-col";
import { TagTooltip } from "./entity-card-tag-tooltip";
import {
  type EntityCardBaseProps,
  buildSearchParams,
  getItemUrl,
} from "./entity-card-utils";
import { EntityThumbnail } from "./thumbnail-client";

type Props = EntityCardBaseProps & {
  flex?: "flex-row" | "flex-col";
};

/** A file as a card in the grid: its picture first, then its name. */
export function EntityCardRow({
  entity,
  sortBy = "updatedAt",
  sortOrder = "desc",
  isOverlay = false,
  flex = "flex-row",
}: Props) {
  const href = getItemUrl({
    id: entity.id,
    entityType: entity.entityType,
    searchParams: buildSearchParams({ flex, sortBy, sortOrder }),
  });

  return (
    <Card
      id={`entity-${entity.id}`}
      className={cn(
        "flex flex-col gap-2 p-2 sm:p-3",
        isOverlay && "cursor-grabbing shadow-lg",
      )}
    >
      <Link href={href} draggable={false} tabIndex={-1} aria-hidden="true">
        <EntityThumbnail entity={entity} variant="card" />
      </Link>

      <div className="flex items-start gap-1">
        <Link
          href={href}
          draggable={false}
          className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md py-0.5 pl-1"
        >
          <span className="truncate text-row font-medium select-none">
            {entity.title}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
            <EntityTypeIcon
              type={entity.entityType}
              className="size-3.5 shrink-0"
            />
            <span className="max-sm:sr-only">
              {entityTypeLabel(entity.entityType)}
            </span>
            <span aria-hidden="true" className="max-sm:hidden">
              ·
            </span>
            <span className="truncate">
              <EntityTime
                date={
                  sortBy === "createdAt" ? entity.createdAt : entity.updatedAt
                }
                created={sortBy === "createdAt"}
              />
            </span>
            {entity.archivedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Archived</span>
              </>
            )}
          </span>
        </Link>

        <div className="flex shrink-0 items-center">
          {entity.tags.length > 0 && (
            <TagTooltip entity={entity} className="hidden lg:flex" />
          )}
          {isOverlay ? (
            <Button
              size="icon"
              variant="ghost"
              disabled
              aria-label={`More actions for ${entity.title}`}
            >
              <EllipsisIcon className="size-5" />
            </Button>
          ) : (
            <MoreActions entity={entity} currentAccess={entity.publicAccess} />
          )}
        </div>
      </div>
    </Card>
  );
}
