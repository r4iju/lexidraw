"use client";

import { EllipsisIcon, Folder } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { MoreActions } from "./_actions/more-actions";
import { TagTooltip } from "./entity-card-tag-tooltip";
import {
  type EntityCardBaseProps,
  buildSearchParams,
  getItemUrl,
} from "./entity-card-utils";

/** A folder in the grid: a compact tile with its name and what's in it. */
export function FolderCard({
  entity,
  sortBy = "updatedAt",
  sortOrder = "desc",
  isOverlay = false,
}: EntityCardBaseProps) {
  const href = getItemUrl({
    id: entity.id,
    entityType: entity.entityType,
    searchParams: buildSearchParams({ flex: "flex-row", sortBy, sortOrder }),
  });

  return (
    <Card
      id={`entity-${entity.id}`}
      className={cn(
        "flex h-15 items-center gap-0.5 pr-0.5 pl-2.5 sm:gap-1 sm:pr-1 sm:pl-3",
        isOverlay && "cursor-grabbing shadow-lg",
      )}
    >
      <Link
        href={href}
        draggable={false}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch sm:gap-3 rounded-md outline-offset-2"
      >
        <Folder
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-5 shrink-0 text-muted-foreground"
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-row font-medium select-none">
            {entity.title}
          </span>
          <span className="truncate text-caption text-muted-foreground">
            {itemCount(entity.childCount)}
            {entity.archivedAt && " · Archived"}
          </span>
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
    </Card>
  );
}

function itemCount(count: number) {
  if (count === 0) return "Empty";
  return `${count} ${count === 1 ? "item" : "items"}`;
}
