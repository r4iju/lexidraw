"use client";

import { Folder } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EntityTypeIcon } from "~/lib/entity-types";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/shared";
import { ThemedThumbnail } from "./themed-thumbnail";

type Entity = RouterOutputs["entities"]["list"][number];

type Props = {
  entity: Entity;
  /** 40×40 in a list row, or 4:3 across a grid card. */
  variant: "row" | "card";
};

/** A file's picture, in the page's theme, or a quiet stand-in for its type. */
export function EntityThumbnail({ entity, variant }: Props) {
  // Folders have no picture of their own, so theirs never stops pending.
  const pending =
    entity.entityType !== "directory" && entity.thumbnailStatus === "pending";
  useRefreshWhilePending(pending);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden border border-border bg-card",
        variant === "row"
          ? "size-10 rounded-md"
          : "aspect-4/3 w-full rounded-md",
      )}
    >
      {entity.entityType === "directory" ? (
        <FolderVisual variant={variant} childCount={entity.childCount} />
      ) : (
        <ThemedThumbnail
          light={entity.screenShotLight}
          dark={entity.screenShotDark}
          alt=""
          sizes={
            variant === "row"
              ? "40px"
              : "(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
          }
          className={
            entity.entityType === "url" ? "object-cover object-top" : undefined
          }
          fallback={<Placeholder type={entity.entityType} variant={variant} />}
        />
      )}
      {pending && (
        <div className="absolute inset-0 animate-pulse bg-foreground/5" />
      )}
    </div>
  );
}

/**
 * A new file's picture is drawn in the background; the list is refreshed once
 * it has had time to land, and at most every few seconds across cards.
 */
function useRefreshWhilePending(pending: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    const id = setTimeout(() => {
      const now = Date.now();
      try {
        const last = Number(sessionStorage.getItem("ld_dash_refresh_at") || 0);
        if (now - last < 8000) return;
        sessionStorage.setItem("ld_dash_refresh_at", String(now));
      } catch {
        // Without sessionStorage every card may refresh; that's still correct.
      }
      router.refresh();
    }, 8000);
    return () => clearTimeout(id);
  }, [pending, router]);
}

function FolderVisual({
  variant,
  childCount,
}: {
  variant: "row" | "card";
  childCount: number;
}) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-muted/60 text-muted-foreground">
      <span className="flex flex-col items-center gap-1">
        <Folder
          aria-hidden="true"
          strokeWidth={1.5}
          className={variant === "row" ? "size-5" : "size-10 sm:size-12"}
        />
        {variant === "card" && (
          <span className="text-caption">
            {childCount === 0
              ? "Empty"
              : `${childCount} ${childCount === 1 ? "item" : "items"}`}
          </span>
        )}
      </span>
    </div>
  );
}

function Placeholder({
  type,
  variant,
}: {
  type: string;
  variant: "row" | "card";
}) {
  return (
    <div
      className={cn(
        "absolute inset-0 grid place-items-center text-muted-foreground/70",
        variant === "card" &&
          type === "document" &&
          "bg-[repeating-linear-gradient(transparent,transparent_12px,var(--color-border)_12px,var(--color-border)_13px)]",
        variant === "card" &&
          type !== "document" &&
          "bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_1px)] bg-size-[12px_12px]",
      )}
    >
      <EntityTypeIcon
        type={type}
        className={variant === "row" ? "size-4" : "size-8"}
      />
    </div>
  );
}
