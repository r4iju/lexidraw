import { LayoutGrid, Rows3 } from "lucide-react";
import Link from "next/link";
import type { AppBarAccount } from "~/components/app-bar/account-menu";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/server";
import type { RouterOutputs } from "~/trpc/shared";
import { NewEntity } from "./_actions/new-entity";
import { CanonicalizeDashboardURL } from "./canonicalize-dashboard-url";
import { DashboardAppBar } from "./dashboard-app-bar";
import { FilterSortSheet, SheetField, StickyBar } from "./dashboard-bar";
import { DashboardEntities } from "./dashboard-entities";
import { DraggingContext } from "./dnd-context";
import { EmptyState } from "./empty-state";
import { FilterByTags } from "./filter-by-tags";
import { PersistDashboardPrefsCookie } from "./persist-dashboard-prefs-cookie";
import { SearchBar, SearchButton } from "./search";
import { SortMenu } from "./sort-menu";
import { replaceSearchParam } from "./utils";
import {
  type DashboardView,
  FilterHint,
  ViewFilter,
  viewFilters,
} from "./view-filter";

type Props = {
  account: AppBarAccount | null;
  directory?: RouterOutputs["entities"]["getMetadata"];
  sortBy: "updatedAt" | "createdAt" | "title";
  sortOrder: "asc" | "desc";
  flex: "flex-row" | "flex-col";
  tags?: string;
  view: DashboardView;
};

// The app bar's gutter, so the title and the files line up under Home.
const GUTTER = "w-full px-4 sm:px-6 lg:px-8";

export async function Dashboard({
  account,
  directory,
  sortBy,
  sortOrder,
  flex,
  tags,
  view,
}: Props) {
  const searchParams = new URLSearchParams({
    ...(flex ? { flex } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortOrder ? { sortOrder } : {}),
    ...(tags ? { tags } : {}),
    view,
  });
  const pathname = `/dashboard/${directory?.id ?? ""}`;
  const tagList = tags ? tags.split(",").filter(Boolean) : [];
  const [entities, allTags] = await Promise.all([
    api.entities.list.query({
      parentId: directory?.id,
      sortBy,
      sortOrder,
      tagNames: tagList,
      ...viewFilters(view),
    }),
    api.entities.getUserTags.query(),
  ]);
  const parentId = directory?.id ?? null;

  const layoutToggle = (
    <div className="flex gap-2">
      {(
        [
          ["flex-row", "Grid view", LayoutGrid],
          ["flex-col", "List view", Rows3],
        ] as const
      ).map(([value, label, Icon]) => (
        <Button
          key={value}
          variant={flex === value ? "on" : "outline"}
          size="icon"
          asChild
        >
          <Link
            href={replaceSearchParam({
              pathname,
              prevParams: searchParams,
              key: "flex",
              value,
            })}
            aria-current={flex === value ? "true" : undefined}
          >
            <Icon />
            <span className="sr-only">{label}</span>
          </Link>
        </Button>
      ))}
    </div>
  );

  return (
    <DraggingContext sortBy={sortBy} sortOrder={sortOrder}>
      <PersistDashboardPrefsCookie />
      <CanonicalizeDashboardURL
        canonical={{ sortBy, sortOrder, flex, tags, view }}
      />
      <DashboardAppBar
        account={account}
        query={searchParams.toString()}
        folder={
          directory && {
            id: directory.id,
            title: directory.title,
            canRename: directory.isOwner,
            ancestors: directory.ancestors.map(({ id, title }) => ({
              id,
              title,
            })),
          }
        }
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 w-full flex-1 flex-col overflow-auto"
      >
        <StickyBar>
          <div
            className={cn(
              GUTTER,
              "flex flex-col gap-2 py-3 transition-[padding] group-data-scrolled/bar:py-2",
            )}
          >
            <div className="flex min-h-10 items-center gap-1 sm:gap-2">
              <h1 className="min-w-0 flex-1 truncate text-title font-semibold transition-[font-size] max-md:group-data-scrolled/bar:text-lg">
                {directory?.title || "Home"}
              </h1>
              <div className="flex items-center gap-1 md:hidden">
                <SearchButton />
              </div>
              <div className="lg:hidden">
                <FilterSortSheet
                  active={tagList.length + (view === "all" ? 0 : 1)}
                >
                  <SheetField label="Show">
                    <ViewFilter
                      view={view}
                      pathname={pathname}
                      searchParams={searchParams}
                    />
                  </SheetField>
                  <SheetField label="Tags">
                    <FilterByTags options={allTags} wide />
                  </SheetField>
                  <SheetField label="Layout">{layoutToggle}</SheetField>
                  <SheetField label="Sort">
                    <SortMenu className="justify-start" />
                  </SheetField>
                </FilterSortSheet>
              </div>
              <NewEntity parentId={parentId} compact />
            </div>

            <div
              role="toolbar"
              aria-label="Files and filters"
              className="hidden items-center gap-2 md:flex"
            >
              <SearchBar className="min-w-0 flex-1 lg:max-w-md" />
              <div className="hidden flex-1 items-center justify-end gap-2 lg:flex">
                <FilterByTags options={allTags} />
                <ViewFilter
                  view={view}
                  pathname={pathname}
                  searchParams={searchParams}
                />
                {layoutToggle}
                <SortMenu />
              </div>
            </div>

            <FilterHint
              view={view}
              tags={tags}
              pathname={pathname}
              searchParams={searchParams}
            />
          </div>
        </StickyBar>

        <div className={cn(GUTTER, "flex-1 pb-8 pt-1")}>
          {entities.length === 0 ? (
            <EmptyState
              inFolder={Boolean(directory)}
              view={view}
              tags={tags}
              pathname={pathname}
              searchParams={searchParams}
              action={<NewEntity parentId={parentId} />}
            />
          ) : (
            <DashboardEntities
              entities={entities}
              flex={flex}
              sortBy={sortBy}
              sortOrder={sortOrder}
            />
          )}
        </div>
      </main>
    </DraggingContext>
  );
}
