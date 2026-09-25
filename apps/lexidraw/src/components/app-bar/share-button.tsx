"use client";

import { Share2Icon } from "lucide-react";
import ShareEntity, {
  type Shareable,
} from "~/app/dashboard/_actions/share-entity";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** Opens the share dialog the dashboard uses, from the app bar. */
export function ShareDialog({
  entity,
  open,
  onOpenChange,
}: {
  entity: Shareable;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return (
    <ShareEntity entity={entity} isOpen={open} onOpenChange={onOpenChange} />
  );
}

export function ShareButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "justify-center pointer-coarse:min-w-11",
        className ?? "h-9 gap-1.5 px-2.5",
      )}
    >
      <Share2Icon className="size-4" aria-hidden />
      <span className="max-lg:sr-only">Share</span>
    </Button>
  );
}
