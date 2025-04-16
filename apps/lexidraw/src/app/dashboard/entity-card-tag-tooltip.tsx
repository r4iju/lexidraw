"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { TagsIcon } from "lucide-react";
import TagEntityModal from "./_actions/tag-modal";
import { useState } from "react";
import type { RouterOutputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type Entity = RouterOutputs["entities"]["list"][number];

export const TagTooltip = ({
  entity,
  className,
}: {
  entity: Entity;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            className={cn(className, "items-center justify-center")}
          >
            <TagsIcon className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="flex flex-col">
          {entity.tags.length > 0 ? (
            entity.tags.map((tag) => (
              <p key={tag} className="text-sm text-muted-foreground">
                {tag}
              </p>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No tags</p>
          )}
        </TooltipContent>
      </Tooltip>
      <TagEntityModal entity={entity} isOpen={open} onOpenChange={setOpen} />
    </TooltipProvider>
  );
};
