"use client";

import { useState, useRef, type RefObject, useMemo, useEffect } from "react";
import { Input } from "~/components/ui/input";
import { useDebounceValue } from "~/lib/client-utils";
import { api } from "~/trpc/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Brush, File, Folder, Link2, Loader2 } from "lucide-react";
import Image from "next/image";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import type { RouterOutputs } from "~/trpc/shared";
import { cn } from "~/lib/utils";
import Link from "next/link";

type CombinedSearchResult = RouterOutputs["entities"]["search"][number] &
  Partial<RouterOutputs["entities"]["deepSearch"][number]>;

type Props = {
  className?: string;
};

export function SearchBar({ className }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasScrolledOnFocusRef = useRef(false);
  const isDarkTheme = useIsDarkTheme();
  const [displayResults, setDisplayResults] = useState<CombinedSearchResult[]>(
    [],
  );
  const previousDebouncedQueryRef = useRef<string>(null);

  const [debouncedQuery] = useDebounceValue(query, 300);

  const { data: titleSearchResults, isLoading: isTitleLoading } =
    api.entities.search.useQuery(
      { query: debouncedQuery },
      {
        enabled: debouncedQuery.length > 0,
        staleTime: 1000 * 60 * 5,
      },
    );

  // Deep search for content and tags
  const { data: deepSearchResults, isLoading: isDeepLoading } =
    api.entities.deepSearch.useQuery(
      { query: debouncedQuery },
      {
        enabled: debouncedQuery.length > 1,
        staleTime: 1000 * 60 * 5, // Re-add staleTime
      },
    );
  // --- End Fetch ---

  const currentCombinedResults = useMemo(() => {
    const allResults = [
      ...(titleSearchResults || []),
      ...(deepSearchResults || []),
    ];
    const uniqueResults = new Map<string, CombinedSearchResult>();
    for (const result of allResults) {
      const existing = uniqueResults.get(result.id);
      if (!existing || (!existing.screenShotLight && result.screenShotLight)) {
        uniqueResults.set(result.id, result);
      }
    }
    return Array.from(uniqueResults.values());
  }, [titleSearchResults, deepSearchResults]);

  // Show loading if either query is fetching
  const isLoading = isTitleLoading || isDeepLoading;

  //  update displayResults "intelligently"
  useEffect(() => {
    if (!isLoading) {
      // if loading is finished, always update display results
      setDisplayResults(currentCombinedResults);
      previousDebouncedQueryRef.current = debouncedQuery;
    } else {
      // if loading has started for a *new* query, clear previous results
      // only if the query is different from the one that produced the current display results.
      // otherwise, keep showing the stale displayResults.
    }
  }, [isLoading, currentCombinedResults, debouncedQuery]);

  const toPath = ({
    entityType,
    entityId,
  }: {
    entityType: string;
    entityId: string;
  }) => {
    switch (entityType) {
      case "drawing":
        return `/drawings/${entityId}`;
      case "document":
        return `/documents/${entityId}`;
      case "url":
        return `/urls/${entityId}`;
      default:
        return `/dashboard/${entityId}`;
    }
  };

  const toDateString = (date: Date) => {
    return formatDistanceToNow(date, { addSuffix: true });
  };

  // Ensure the input is fully visible on mobile when focusing/typing
  const scrollInputIntoView = (mode: "normal" | "tight" = "normal") => {
    if (typeof window === "undefined") return;
    // Only apply this behavior on small screens
    const isSmallScreen =
      "matchMedia" in window && window.matchMedia("(max-width: 768px)").matches;
    if (!isSmallScreen) return;

    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewport = {
      height: window.innerHeight || document.documentElement.clientHeight,
    };
    // Leave a small sliver visible to maximize space for results + keyboard
    const visibleSliver = 8; // px
    const targetTop =
      mode === "tight"
        ? // push almost entirely off-screen (keep bottom sliver visible)
          window.scrollY + rect.top + (rect.height - visibleSliver)
        : // keep the input near the top and fully visible
          window.scrollY + rect.top - 12;
    // clamp within scrollable range
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight,
    );
    const maxScrollTop = Math.max(0, docHeight - viewport.height);
    const top = Math.max(0, Math.min(targetTop, maxScrollTop));
    try {
      window.scrollTo({ top, behavior: "smooth" });
    } catch {
      window.scrollTo(0, top);
    }
  };

  return (
    <Popover>
      <div className={cn("w-full", className)}>
        <PopoverTrigger asChild>
          <Input
            ref={inputRef as RefObject<HTMLInputElement>}
            type="text"
            placeholder="🔎 Search by title, content, or tags..."
            value={query}
            onFocus={() => {
              hasScrolledOnFocusRef.current = false;
              scrollInputIntoView();
            }}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              // On first keystroke after focus, nudge into view
              if (!hasScrolledOnFocusRef.current && next.length > 0) {
                scrollInputIntoView("tight");
                hasScrolledOnFocusRef.current = true;
              }
            }}
            className={cn(
              "h-12 md:h-10 w-full",
              "pr-8", // keep room for the spinner
              "font-medium text-center",
              "placeholder-shown:text-center",
              "placeholder:text-muted-foreground",
              "focus:outline-hidden",
            )}
          />
        </PopoverTrigger>
        {isLoading && debouncedQuery.length > 0 && (
          <Loader2 className="absolute right-2 top-1/3 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      <PopoverContent
        className={cn("w-(--radix-popover-trigger-width) p-0 mt-1 ", {
          hidden: !isLoading && debouncedQuery.length === 0,
        })}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            {/* Empty State: Show if not loading, query exists, but no results */}
            <CommandEmpty>
              No results found for "{debouncedQuery}".
            </CommandEmpty>

            {/* Results Group: Show if we have results to display */}
            {displayResults.length > 0 && (
              <CommandGroup heading="Results">
                {displayResults.map((entity) => (
                  <Link
                    key={entity.id}
                    href={toPath({
                      entityType: entity.entityType,
                      entityId: entity.id,
                    })}
                  >
                    <CommandItem
                      value={entity.id}
                      className="flex items-center h-16 gap-4 justify-between"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        {entity.screenShotLight && entity.screenShotDark && (
                          <div className="relative h-12 w-12 overflow-hidden rounded-sm shrink-0">
                            <Image
                              src={
                                isDarkTheme
                                  ? entity.screenShotDark
                                  : entity.screenShotLight
                              }
                              alt={entity.title}
                              className="mr-2 h-12 w-12 shrink-0"
                              width={48}
                              height={48}
                              style={{
                                objectFit: "cover",
                              }}
                            />
                          </div>
                        )}
                        <div className="flex flex-col gap-1 min-w-0 ">
                          <span className="truncate grow text-md min-w-0">
                            {entity.title}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {toDateString(entity.updatedAt)}
                          </span>
                        </div>
                      </div>
                      {entity.entityType === "directory" && (
                        <Folder className="h-4 w-4 shrink-0" />
                      )}
                      {entity.entityType === "drawing" && (
                        <Brush className="h-4 w-4 shrink-0" />
                      )}
                      {entity.entityType === "document" && (
                        <File className="h-4 w-4 shrink-0" />
                      )}
                      {entity.entityType === "url" && (
                        <Link2 className="h-4 w-4 shrink-0" />
                      )}
                    </CommandItem>
                  </Link>
                ))}
              </CommandGroup>
            )}

            {/* Loading Skeleton: Show if loading is in progress */}
            {isLoading && (
              <CommandGroup
                heading={
                  displayResults.length > 0 ? "Loading more..." : "Searching..."
                }
              >
                {[...Array(displayResults.length ? 2 : 4)].map((_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton item
                  <CommandItem key={index} disabled>
                    <div className="flex items-center gap-4 h-12 w-full">
                      <div className="h-10 w-10 bg-muted rounded-sm animate-pulse"></div>
                      <div className="flex flex-col gap-2 grow">
                        <div className="h-4 w-3/4 bg-muted rounded-sm animate-pulse"></div>
                        <div className="h-3 w-1/2 bg-muted rounded-sm animate-pulse"></div>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
