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
};

export function FilterByTags({ options }: Props) {
  const [open, setOpen] = React.useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const selected = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];

  const placholderText = (() => {
    switch (selected.length) {
      case 0:
        return "Filter by tags...";
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
      restParams.delete("tags");
    } else {
      restParams.set("tags", newTags.join(","));
    }
    router.push(`${pathname}?${restParams.toString()}`);
  };

  console.log({ selected, options });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* mobile */}
      <>
        <div className="contents md:hidden">
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              role="combobox"
              aria-expanded={open}
              className="relative"
            >
              <TagsIcon className="size-6" />
              {/* negative margin to offset the icon size, top right */}
              <div className="absolute -top-4 -right-2 flex items-center justify-center">
                <span className="text-sm font-medium text-foreground bg-muted rounded-full ring-1 ring-offset-background ring-background px-2 py-1">
                  {selected.length}
                </span>
              </div>
            </Button>
          </PopoverTrigger>
        </div>
        {/* desktop */}
        <div className="hidden md:contents">
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-[200px] justify-between"
            >
              {placholderText}
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
        </div>
      </>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder="Search tags..." />
          <CommandList>
            <CommandEmpty>No tags found.</CommandEmpty>
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
