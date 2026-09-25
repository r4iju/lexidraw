"use client";

import { Loader2, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "~/components/ui/popover";
import { useDebounceValue } from "~/lib/client-utils";
import { leaveThen } from "~/lib/leave-guard";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { type SearchResult, SearchResults } from "./search-results";

const PLACEHOLDER = "Search by name, text or tag…";

/**
 * Title hits and content or tag hits for `query`, one row per file. Rows from
 * the last finished search stay up while the next one runs.
 */
function useSearch(query: string) {
  const [debouncedQuery] = useDebounceValue(query, 300);
  const titles = api.entities.search.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length > 0, staleTime: 1000 * 60 * 5 },
  );
  const content = api.entities.deepSearch.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length > 1, staleTime: 1000 * 60 * 5 },
  );
  const loading =
    debouncedQuery !== query.trim() ||
    (debouncedQuery.length > 0 && titles.isLoading) ||
    (debouncedQuery.length > 1 && content.isLoading);

  const combined = useMemo(() => {
    const byId = new Map<string, SearchResult>();
    for (const hit of [...(titles.data ?? []), ...(content.data ?? [])]) {
      const known = byId.get(hit.id);
      byId.set(hit.id, {
        ...hit,
        snippet: known?.snippet ?? hit.snippet,
      });
    }
    return [...byId.values()];
  }, [titles.data, content.data]);

  const [shown, setShown] = useState<SearchResult[]>([]);
  useEffect(() => {
    if (!loading) setShown(query.trim() ? combined : []);
  }, [loading, combined, query]);

  return { results: shown, loading: loading && query.trim() !== "" };
}

function useOpenResult() {
  const router = useRouter();
  return (href: string) => leaveThen(() => router.push(href));
}

/** Search in the toolbar, with results in a panel under it. */
export function SearchBar({ className }: { className?: string }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { results, loading } = useSearch(query);
  const openResult = useOpenResult();
  const fieldRef = useRef<HTMLDivElement>(null);

  return (
    <Popover open={open && query.trim() !== ""} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={fieldRef}
          className={cn("relative flex items-center", className)}
        >
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search files"
            placeholder={PLACEHOLDER}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            className="h-10 w-full bg-background pl-9 pr-9"
          />
          {loading && (
            <Loader2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sheet={false}
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // The field is outside the panel, and clicking back into it keeps
          // the results up.
          if (fieldRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <SearchResults
          query={query}
          results={results}
          loading={loading}
          onClearSearch={() => setQuery("")}
          onOpen={openResult}
          className="max-h-[min(28rem,60dvh)] overflow-y-auto"
        />
      </PopoverContent>
    </Popover>
  );
}

/** Search on a phone: a button that opens search over the whole screen. */
export function SearchButton() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { results, loading } = useSearch(query);
  const openResult = useOpenResult();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Search files"
        onClick={() => setOpen(true)}
      >
        <SearchIcon className="size-5" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          size="full"
          // The Cancel beside the field closes search, in place of the corner
          // button the field would sit under.
          className="flex flex-col gap-0 p-0 max-sm:p-0 [&>button:last-child]:hidden"
        >
          <DialogTitle className="sr-only">Search files</DialogTitle>
          <div className="flex items-center gap-2 border-b border-border px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <div className="relative flex-1">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                ref={inputRef}
                type="search"
                aria-label="Search files"
                placeholder={PLACEHOLDER}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 bg-background pl-9 text-base"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
          <SearchResults
            query={query}
            results={results}
            loading={loading}
            onClearSearch={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            onOpen={(href) => {
              setOpen(false);
              openResult(href);
            }}
            className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
