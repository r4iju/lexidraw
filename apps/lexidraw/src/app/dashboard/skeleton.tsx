"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { DASHBOARD_PREFS_COOKIE, readDashboardPrefs } from "./dashboard-prefs";
import { GUTTER } from "./utils";

const GRID = "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4";
const CONTROL = "h-10 pointer-coarse:h-11";

/**
 * The layout Home will show, from its `flex`: the address's, else the one
 * chosen last time (the prefs cookie); the list if neither says grid.
 */
const viewOf = (flex: string | null | undefined) =>
  flex === "flex-row" ? "grid" : "list";

/**
 * The same, run inline as the server's HTML is parsed, before the page's
 * scripts, Zod's included, have loaded; so it reads the one field itself.
 */
function readViewBeforeScripts(cookieName: string) {
  let flex = new URLSearchParams(location.search).get("flex");
  const row = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${cookieName}=`));
  if (!flex && row) {
    try {
      flex = JSON.parse(
        decodeURIComponent(row.slice(cookieName.length + 1)),
      ).flex;
    } catch {}
  }
  return flex === "flex-row" ? "grid" : "list";
}

const setViewBeforePaint = `document.currentScript.parentElement.dataset.view=(${readViewBeforeScripts.toString()})(${JSON.stringify(DASHBOARD_PREFS_COOKIE)})`;

const subscribeToNothing = () => () => {};

/**
 * Home or a folder while it loads, laid out as the listing will be: its app
 * bar, title and toolbar, then list rows or grid cards, whichever the reader
 * will get. Both are drawn and the layout picks one before the first paint,
 * so the server need not wait for the request to know which.
 */
export function DashboardSkeleton({ folder = false }: { folder?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  // The inline script only runs as the server's HTML is parsed; rendered in
  // the browser it would never run, so only the hydrating render keeps it.
  const hydrating = useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  );
  // A navigation in the browser has its address by the time this commits.
  useLayoutEffect(() => {
    if (!root.current) return;
    root.current.dataset.view = viewOf(
      new URLSearchParams(location.search).get("flex") ||
        readDashboardPrefs(document.cookie).flex,
    );
  }, []);

  return (
    <div
      ref={root}
      data-loading="home"
      aria-busy="true"
      className="group/loading contents"
      suppressHydrationWarning
    >
      {hydrating && (
        <script
          suppressHydrationWarning
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant of our own
          dangerouslySetInnerHTML={{ __html: setViewBeforePaint }}
        />
      )}
      <AppBar
        account={undefined}
        crumbs={
          folder && (
            <Crumb current>
              <Skeleton className="mx-1.5 h-4 w-32" />
            </Crumb>
          )
        }
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      >
        <div aria-hidden="true" className="h-px shrink-0" />
        <div className="shrink-0 border-b border-transparent bg-background">
          <div className={cn(GUTTER, "flex flex-col gap-2 py-3")}>
            <div className="flex min-h-10 items-center gap-1 sm:gap-2">
              <h1 className="min-w-0 flex-1 truncate text-title font-semibold">
                {folder ? <Skeleton className="h-[1lh] w-48" /> : "Home"}
              </h1>
              <Skeleton className={cn(CONTROL, "aspect-square md:hidden")} />
              <Skeleton className={cn(CONTROL, "aspect-square lg:hidden")} />
              <Skeleton className={cn(CONTROL, "w-24 max-sm:w-10")} />
            </div>
            <div className="hidden items-center gap-2 md:flex">
              <Skeleton className="h-10 min-w-0 flex-1 lg:max-w-md" />
              <div className="hidden flex-1 items-center justify-end gap-2 lg:flex">
                <Skeleton className={cn(CONTROL, "w-24")} />
                <Skeleton className={cn(CONTROL, "w-28")} />
                <Skeleton className={cn(CONTROL, "w-22")} />
                <Skeleton className={cn(CONTROL, "w-44")} />
              </div>
            </div>
          </div>
        </div>

        <div className={cn(GUTTER, "flex-1 pb-8 pt-1")}>
          <section className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card group-data-[view=grid]/loading:hidden">
            {Array.from({ length: 12 }, (_, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
                key={index}
                data-skeleton-item={index === 0 || undefined}
                className="flex h-14 items-center gap-3 pr-1 pl-2 sm:pl-3"
              >
                <Skeleton className="size-10 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-1/3 min-w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="mr-12 hidden h-3 w-20 md:block" />
              </div>
            ))}
          </section>
          <section
            className={cn(GRID, "hidden group-data-[view=grid]/loading:grid")}
          >
            {Array.from({ length: 8 }, (_, index) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
                key={index}
                data-skeleton-item={index === 0 || undefined}
                className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
              >
                <Skeleton className="aspect-4/3 w-full rounded-none" />
                <div className="flex flex-col gap-1.5 p-2 sm:px-3 sm:pb-3">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
