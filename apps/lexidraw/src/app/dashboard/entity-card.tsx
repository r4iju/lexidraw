import Link from "next/link";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { PublicAccess } from "@packages/types";
import type { RouterOutputs } from "~/trpc/shared";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { MoreActions } from "./_actions/more-actions";
import { ThumbnailClient } from "./thumbnail-client";
import EntityTitle from "./_actions/rename-inline";

type Entity = RouterOutputs["entities"]["list"][number];

type Props = {
  entity: Entity;
  flex: "flex-row" | "flex-col";
  sortBy?: "updatedAt" | "createdAt" | "title";
  isOverlay?: boolean;
};

export function EntityCard({
  entity,
  flex,
  sortBy = "updatedAt",
  isOverlay = false,
}: Props) {
  const updatedOrCreated = sortBy === "createdAt" ? "Created " : "Updated ";
  const dateString = formatDistanceToNow(
    new Date(sortBy === "createdAt" ? entity.createdAt : entity.updatedAt),
    { addSuffix: true },
  );

  return (
    <Card
      className={cn(
        "relative flex gap-4 rounded-lg p-4 hover:bg-muted/20 transition-colors duration-150 justify-between",
        flex === "flex-row" && "flex-col",
        flex === "flex-col" && "flex-row",
        isOverlay && "cursor-grabbing bg-muted bg-opacity-100", // a visual cue
      )}
    >
      {/* left side */}
      <div
        className={cn(
          "flex flex-row items-center gap-4",
          flex === "flex-row" && "hidden",
        )}
      >
        <div className="size-10 min-w-10">
          <ThumbnailClient entity={entity} />
        </div>
        <span className="font-semibold line-clamp-1 w-full">
          {entity.title}
        </span>
      </div>

      {/* middle: date + actions */}
      <div className="flex justify-between items-center gap-4">
        <span
          className={cn(
            "text-sm text-muted-foreground",
            flex === "flex-row" ? "block" : "md:block",
          )}
        >
          {updatedOrCreated}
          {dateString}
        </span>

        <MoreActions
          entity={entity}
          currentAccess={entity.publicAccess as PublicAccess}
        />
      </div>

      {/* right side (if flex-row) */}
      <div
        className={cn(
          "items-center gap-4",
          flex === "flex-row" ? "flex flex-col" : "hidden",
        )}
      >
        <EntityTitle entity={entity} />
        <ThumbnailClient entity={entity} />
      </div>

      {/* "open" button if flex-row */}
      {flex === "flex-row" && (
        <Button className="mt-2 w-full" asChild>
          <Link href={/* your itemUrl logic here */ `#`}>Open</Link>
        </Button>
      )}
    </Card>
  );
}
