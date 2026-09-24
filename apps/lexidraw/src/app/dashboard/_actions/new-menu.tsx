"use client";

import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { EntityTypeIcon, entityTypeLabel } from "~/lib/entity-types";
import { cn } from "~/lib/utils";

export type NewKind = "document" | "drawing" | "directory" | "url";

const KINDS: { type: NewKind; description: string }[] = [
  {
    type: "document",
    description: "Write with headings, tables, embeds and slides.",
  },
  {
    type: "drawing",
    description: "Sketch diagrams and wireframes on a canvas.",
  },
  { type: "directory", description: "Group files together." },
  { type: "url", description: "Save a web page to read or listen to later." },
];

type Props = {
  onCreate: (kind: NewKind) => void;
  /** A file is being created; the menu can't start another. */
  pending?: boolean;
  /** Only the plus on phones, where the toolbar has no room for the word. */
  compact?: boolean;
};

/** "New", as a menu of the kinds of file there are. */
export function NewMenu({ onCreate, pending = false, compact = false }: Props) {
  const Icon = pending ? LoaderCircleIcon : PlusIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          disabled={pending}
          aria-busy={pending}
          className={cn("gap-2", compact && "max-sm:size-10 max-sm:px-0")}
        >
          <Icon
            className={cn("size-4", pending && "animate-spin")}
            aria-hidden="true"
          />
          <span className={cn(compact && "max-sm:sr-only")}>New</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {KINDS.map(({ type, description }) => (
          <DropdownMenuItem
            key={type}
            onSelect={() => onCreate(type)}
            className="items-start gap-3 py-2"
          >
            <EntityTypeIcon type={type} className="mt-0.5 size-4 shrink-0" />
            <span className="flex flex-col gap-0.5">
              <span data-label>{entityTypeLabel(type)}</span>
              <span className="text-caption font-normal text-muted-foreground">
                {description}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
