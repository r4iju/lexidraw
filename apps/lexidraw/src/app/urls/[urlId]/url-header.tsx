"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import type { RouterOutputs } from "~/trpc/shared";
import UrlOptionsDropdown from "./url-options-dropdown";
import { useMemo } from "react";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { cn } from "~/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { IconNarrow, IconMedium, IconWide } from "./icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

type Props = {
  entity: RouterOutputs["entities"]["load"];
  onChangeUrl: () => void;
  className?: string;
  width: "narrow" | "medium" | "wide";
  onWidthChange: (value: "narrow" | "medium" | "wide") => void;
};

export default function UrlHeader({
  entity,
  onChangeUrl,
  className,
  width,
  onWidthChange,
}: Props) {
  const url = useMemo(() => {
    try {
      const parsed = JSON.parse(entity.elements ?? "{}") as { url?: string };
      return parsed.url ?? "";
    } catch {
      return "";
    }
  }, [entity.elements]);

  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-border py-4 px-4 lg:px-6",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <UrlOptionsDropdown entity={entity} onChangeUrl={onChangeUrl} />

        <ToggleGroup
          type="single"
          value={width}
          onValueChange={(v) =>
            v && onWidthChange(v as "narrow" | "medium" | "wide")
          }
          className="gap-0 hidden md:flex rounded-md border border-border"
          size="sm"
        >
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value="narrow"
                  aria-label="Narrow width"
                  className="rounded-r-none"
                >
                  <IconNarrow />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <span>Narrow width</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value="medium"
                  aria-label="Medium width"
                  className="rounded-none"
                >
                  <IconMedium />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <span>Medium width</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value="wide"
                  aria-label="Wide width"
                  className="rounded-l-none"
                >
                  <IconWide />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <span>Wide width</span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </ToggleGroup>
        {url && (
          <Button asChild variant="outline">
            <Link href={url} target="_blank" rel="noopener noreferrer">
              Go to source
            </Link>
          </Button>
        )}
      </div>
      <ModeToggle />
    </div>
  );
}
