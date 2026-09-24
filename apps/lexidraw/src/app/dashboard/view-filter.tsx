import Link from "next/link";
import { cn } from "~/lib/utils";
import { replaceSearchParam } from "./utils";

export const DASHBOARD_VIEWS = ["all", "favorites", "archived"] as const;
export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

const VIEW_LABEL: Record<DashboardView, string> = {
  all: "All",
  favorites: "Favorites",
  archived: "Archived",
};

/** The list filters a view stands for. */
export function viewFilters(view: DashboardView) {
  return {
    onlyFavorites: view === "favorites",
    onlyArchived: view === "archived",
  };
}

type Props = {
  view: DashboardView;
  pathname: string;
  searchParams: URLSearchParams;
};

export function ViewFilter({ view, pathname, searchParams }: Props) {
  return (
    <nav
      aria-label="Show"
      className="inline-flex h-10 items-stretch rounded-md border border-border bg-muted p-0.5"
    >
      {DASHBOARD_VIEWS.map((option) => (
        <Link
          key={option}
          href={replaceSearchParam({
            pathname,
            prevParams: searchParams,
            key: "view",
            value: option,
          })}
          aria-current={option === view ? "page" : undefined}
          className={cn(
            "flex items-center rounded-sm px-3 text-sm font-medium transition-colors pointer-coarse:min-h-11",
            option === view
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {VIEW_LABEL[option]}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Says what is narrowing the list, so a filter remembered from last time
 * never makes Home look emptier than it is without a reason.
 */
export function FilterHint({
  view,
  tags,
  pathname,
  searchParams,
}: Props & { tags?: string }) {
  const tagList = (tags ?? "").split(",").filter(Boolean);
  if (view === "all" && tagList.length === 0) return null;

  const parts = [
    ...(view === "all" ? [] : [VIEW_LABEL[view]]),
    ...(tagList.length ? [`tagged ${tagList.join(", ")}`] : []),
  ];
  const cleared = new URLSearchParams(searchParams);
  cleared.set("view", "all");
  cleared.set("tags", "");

  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      <span>Filtered: {parts.join(", ")}</span>
      <span aria-hidden="true">·</span>
      <Link
        href={`${pathname}?${cleared.toString()}`}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        Clear
      </Link>
    </p>
  );
}
