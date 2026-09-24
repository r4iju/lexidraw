"use client";

import * as React from "react";
import { Check, ChevronsUpDown, TagsIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Props = {
  options: string[];
  /** Full width with the chosen tags spelled out, as in the filter sheet. */
  wide?: boolean;
};

export function FilterByTags({ options, wide = false }: Props) {
  const [open, setOpen] = React.useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const selected = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];

  const placeholderText = (() => {
    switch (selected.length) {
      case 0:
        return "Filter by tags…";
      case 1:
      case 2:
        // show selected tags
        return `${selected.join(", ")}`;
      default:
        return `${selected.length} tags selected`;
    }
  })();

  const handleSelect = (tag: string) => {
    const restParams = new URLSearchParams(searchParams);
    const currentTags =
      searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];

    if (newTags.length === 0) {
      // Keep the key present but empty so cookie writer can clear it
      restParams.set("tags", "");
    } else {
      restParams.set("tags", newTags.join(","));
    }
    router.push(`${pathname}?${restParams.toString()}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* mobile */}
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Filter by tags"
          className={cn(
            "h-10 justify-between gap-2 px-3 font-normal",
            wide ? "w-full" : "w-50",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <TagsIcon className="size-4 shrink-0 opacity-70" />
            <span className="truncate">{placeholderText}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[var(--radix-popover-trigger-width)] min-w-50 p-0"
      >
        <Command>
          <CommandInput placeholder="Search tags…" />
          <CommandList>
            <CommandEmpty>
              {options.length === 0
                ? "No tags yet. Add tags from a file’s ⋯ menu."
                : "No tags match."}
            </CommandEmpty>
            <CommandGroup>
              {options.map((tag) => (
                <CommandItem
                  key={tag}
                  value={tag}
                  onSelect={() => {
                    handleSelect(tag);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(tag) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {tag}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
