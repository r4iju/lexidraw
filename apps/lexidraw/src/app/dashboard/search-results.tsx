"use client";

import Link from "next/link";
import { Fragment } from "react";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Button } from "~/components/ui/button";
import { LocalTime } from "~/components/ui/local-time";
import { Skeleton } from "~/components/ui/skeleton";
import {
  EntityTypeIcon,
  entityHref,
  entityTypeLabel,
} from "~/lib/entity-types";
import { cn } from "~/lib/utils";
import { ThemedThumbnail } from "./themed-thumbnail";

export type SearchResult = {
  id: string;
  title: string;
  entityType: string;
  updatedAt: Date;
  screenShotLight: string;
  screenShotDark: string;
  folderTitle: string | null;
  snippet: string | null;
};

type Props = {
  query: string;
  results: SearchResult[];
  loading: boolean;
  onClearSearch: () => void;
  /** Opens a result chosen from the keyboard. */
  onOpen?: (href: string) => void;
  className?: string;
};

/** Search hits: what each file is, where it lives, and the text that matched. */
export function SearchResults({
  query,
  results,
  loading,
  onClearSearch,
  onOpen,
  className,
}: Props) {
  const noResults = !loading && results.length === 0 && query.trim() !== "";
  return (
    <Command shouldFilter={false} className={className}>
      <CommandList className="max-h-none">
        {noResults && (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center text-sm">
            <p className="font-medium">No files match “{query}”.</p>
            <p className="text-muted-foreground">
              Search looks in titles, text and tags.
            </p>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onClearSearch}
            >
              Clear search
            </Button>
          </div>
        )}

        {results.length > 0 && (
          <CommandGroup
            heading={`${results.length} ${results.length === 1 ? "file" : "files"}`}
          >
            {results.map((result) => {
              const href = entityHref(result.entityType, result.id);
              return (
                <Link key={result.id} href={href} className="block">
                  <CommandItem
                    value={result.id}
                    onSelect={() => onOpen?.(href)}
                    data-search-result
                    className="flex items-start gap-3 py-2"
                  >
                    <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-card">
                      <ThemedThumbnail
                        light={result.screenShotLight}
                        dark={result.screenShotDark}
                        alt=""
                        sizes="40px"
                        fallback={
                          <span className="grid size-full place-items-center text-muted-foreground">
                            <EntityTypeIcon
                              type={result.entityType}
                              className="size-4"
                            />
                          </span>
                        }
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        data-search-title
                        className="truncate text-row font-medium text-foreground"
                      >
                        {result.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                        <EntityTypeIcon
                          type={result.entityType}
                          className="size-3.5 shrink-0"
                        />
                        <span data-search-folder className="truncate">
                          {entityTypeLabel(result.entityType)} in{" "}
                          {result.folderTitle ?? "Home"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">
                          <LocalTime value={result.updatedAt} format="ago" />
                        </span>
                      </span>
                      {result.snippet && (
                        <span
                          data-search-snippet
                          className="line-clamp-2 text-caption text-muted-foreground"
                        >
                          <Highlight text={result.snippet} query={query} />
                        </span>
                      )}
                    </div>
                  </CommandItem>
                </Link>
              );
            })}
          </CommandGroup>
        )}

        {loading && (
          <CommandGroup
            heading={results.length ? "Searching more…" : "Searching…"}
          >
            {Array.from({ length: results.length ? 1 : 3 }, (_, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows
                key={index}
                className="flex items-center gap-3 px-2 py-2"
              >
                <Skeleton className="size-10" />
                <div className="flex grow flex-col gap-2">
                  <Skeleton className="h-4 w-3/4 rounded-sm" />
                  <Skeleton className="h-3 w-1/2 rounded-sm" />
                </div>
              </div>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

/** `text` with each case-insensitive occurrence of `query` marked. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const parts: { text: string; match: boolean }[] = [];
  let from = 0;
  const lower = text.toLowerCase();
  for (
    let at = lower.indexOf(needle);
    at >= 0;
    at = lower.indexOf(needle, from)
  ) {
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.map((part, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
    <Fragment key={index}>
      {part.match ? (
        <mark className={cn("rounded-xs bg-primary/15 text-foreground")}>
          {part.text}
        </mark>
      ) : (
        part.text
      )}
    </Fragment>
  ));
}
