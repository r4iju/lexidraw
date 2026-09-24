"use client";

import { EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { LocalTime } from "~/components/ui/local-time";
import { entityTypeLabel } from "~/lib/entity-types";
import { cn } from "~/lib/utils";
import { MoreActions } from "./_actions/more-actions";
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

/** A file as a row in the list: picture, name, what it is, and when. */
export function EntityCardCol({
  entity,
  sortBy = "updatedAt",
  sortOrder = "desc",
  isOverlay = false,
  flex = "flex-col",
}: Props) {
  const href = getItemUrl({
    id: entity.id,
    entityType: entity.entityType,
    searchParams: buildSearchParams({ flex, sortBy, sortOrder }),
  });
  const time = (
    <EntityTime
      date={sortBy === "createdAt" ? entity.createdAt : entity.updatedAt}
      created={sortBy === "createdAt"}
    />
  );

  return (
    <div
      id={`entity-${entity.id}`}
      className={cn(
        "flex h-14 items-center gap-2 rounded-lg pr-1 pl-2 sm:pl-3",
        isOverlay && "cursor-grabbing bg-card shadow-lg",
      )}
    >
      <Link
        href={href}
        draggable={false}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-md outline-offset-2"
      >
        <EntityThumbnail entity={entity} variant="row" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-row font-medium select-none">
            {entity.title}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
            <span>{entityTypeLabel(entity.entityType)}</span>
            {entity.archivedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>Archived</span>
              </>
            )}
            <span aria-hidden="true" className="md:hidden">
              ·
            </span>
            <span className="truncate md:hidden">{time}</span>
          </span>
        </span>
      </Link>

      <span className="hidden w-28 shrink-0 whitespace-nowrap text-right text-caption text-muted-foreground md:block">
        {time}
      </span>

      <div className="flex shrink-0 items-center">
        {entity.tags.length > 0 && (
          <TagTooltip entity={entity} className="hidden md:flex" />
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
  );
}

/** When a file was last edited, or created when the list is sorted by that. */
export function EntityTime({
  date,
  created,
}: {
  date: Date;
  created: boolean;
}) {
  return (
    <>
      <span className="sr-only">{created ? "Created " : "Edited "}</span>
      <LocalTime value={date} format="ago" />
    </>
  );
}
