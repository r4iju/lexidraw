"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EntityTypeIcon } from "~/lib/entity-types";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/shared";
import { ThemedThumbnail } from "./themed-thumbnail";

type Entity = RouterOutputs["entities"]["list"][number];

type Props = {
  entity: Entity;
  /** 40×40 in a list row, or 4:3 across the top of a grid card. */
  variant: "row" | "card";
  eager: boolean;
};

/** A file's picture, in the page's theme, or a quiet stand-in for its type. */
export function EntityThumbnail({ entity, variant, eager }: Props) {
  // Folders have no picture of their own, so theirs never stops pending.
  const pending =
    entity.entityType !== "directory" && entity.thumbnailStatus === "pending";
  useRefreshWhilePending(pending);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-card",
        variant === "row"
          ? "size-10 rounded-md border border-border"
          : "aspect-4/3 w-full border-b border-border",
      )}
    >
      {entity.entityType === "directory" ? (
        <Placeholder type={entity.entityType} variant={variant} />
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
          deferred={!eager}
        />
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
        "absolute inset-0 grid place-items-center",
        variant === "row"
          ? "text-muted-foreground/70"
          : "bg-background text-muted-foreground/50",
      )}
    >
      <EntityTypeIcon
        type={type}
        className={variant === "row" ? "size-4" : "size-7"}
      />
    </div>
  );
}
