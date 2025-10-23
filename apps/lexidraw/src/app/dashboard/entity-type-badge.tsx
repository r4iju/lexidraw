"use client";

import { Brush, File } from "lucide-react";
import type { EntityType } from "@packages/types";
import { cn } from "~/lib/utils";

type Props = {
  entityType: EntityType | string;
  className?: string;
};

export function EntityTypeBadge({ entityType, className }: Props) {
  const t = String(entityType || "").toLowerCase();
  const isDoc = t === "document";
  const isDrawing = t === "drawing";
  if (!isDoc && !isDrawing) return null;

  return (
    <span
      className={cn(
        "hidden md:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs leading-none border",
        isDoc && "bg-accent/20 text-foreground border-accent/50",
        isDrawing && "bg-primary/15 text-foreground border-primary/40",
        className,
      )}
      role="img"
      aria-label={isDoc ? "Document" : "Drawing"}
    >
      {isDoc ? (
        <File className="size-3" aria-hidden="true" />
      ) : (
        <Brush className="size-3" aria-hidden="true" />
      )}
      <span>{isDoc ? "Doc" : "Draw"}</span>
    </span>
  );
}

export default EntityTypeBadge;
