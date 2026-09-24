import Link from "next/link";
import type { AppBarAccount } from "~/components/app-bar/account-menu";
import { api } from "~/trpc/server";
import type { RouterOutputs } from "~/trpc/shared";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { NewEntity } from "./_actions/new-entity";
import { Drag } from "./drag";
import { Drop } from "./drop";
import { SortMenu } from "./sort-menu";
import { LayoutGrid, Rows3 } from "lucide-react";
import { DraggingContext } from "./dnd-context";
import { EntityCardRow } from "./entity-card-row";
import { EntityCardCol } from "./entity-card-col";
import { replaceSearchParam } from "./utils";
import { FilterByTags } from "./filter-by-tags";
import { SearchBar } from "./search";
import { PersistDashboardPrefsCookie } from "./persist-dashboard-prefs-cookie";
import { CanonicalizeDashboardURL } from "./canonicalize-dashboard-url";
import { DashboardAppBar } from "./dashboard-app-bar";
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
  const entities = await api.entities.list.query({
    parentId: directory?.id,
    sortBy,
    sortOrder,
    tagNames: tags ? tags.split(",").filter(Boolean) : [],
    ...viewFilters(view),
  });

  const allTags = await api.entities.getUserTags.query();

  return (
    <DraggingContext sortBy={sortBy} sortOrder={sortOrder} flex={flex}>
      <PersistDashboardPrefsCookie />
      <CanonicalizeDashboardURL
        canonical={{
          sortBy,
          sortOrder,
          flex,
          tags,
          view,
        }}
      />
      <DashboardAppBar
        account={account}
        query={searchParams.toString()}
        folder={
          directory && {
            id: directory.id,
            title: directory.title,
            canRename: directory.ownerId === account?.id,
            // Someone else's folders above one they were shared are theirs.
            ancestors:
              directory.ownerId === account?.id
                ? directory.ancestors.flatMap((ancestor) =>
                    ancestor.id
                      ? [{ id: ancestor.id, title: ancestor.title }]
                      : [],
                  )
                : [],
          }
        }
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 w-full flex-1 flex-col overflow-auto pb-6 px-4 sm:px-6 lg:px-8"
      >
        <nav
          aria-label="Files and filters"
          className="ui-toolbar flex flex-col py-2 gap-y-2"
        >
          <div className="flex justify-end items-center">
            <NewEntity parentId={directory ? directory.id : null} />
          </div>
          <div className="flex flex-col-reverse md:flex-col-reverse items-stretch gap-2">
            {/* but dont cannibalize the search the buttons */}
            <SearchBar className="w-full" />
            <div className="flex flex-wrap justify-end gap-x-2 gap-y-2 w-full md:w-auto md:self-end">
              {/* filter by tags */}

              <FilterByTags options={allTags} />

              <ViewFilter
                view={view}
                pathname={pathname}
                searchParams={searchParams}
              />

              <div className="flex gap-2">
                <Button
                  variant={flex === "flex-row" ? "on" : "outline"}
                  size="icon"
                  asChild
                >
                  <Link
                    href={replaceSearchParam({
                      pathname,
                      prevParams: searchParams,
                      key: "flex",
                      value: "flex-row",
                    })}
                    aria-current={flex === "flex-row" ? "true" : undefined}
                  >
                    <LayoutGrid />
                    <span className="sr-only">Grid view</span>
                  </Link>
                </Button>
                <Button
                  variant={flex === "flex-col" ? "on" : "outline"}
                  size="icon"
                  asChild
                >
                  <Link
                    href={replaceSearchParam({
                      pathname,
                      prevParams: searchParams,
                      key: "flex",
                      value: "flex-col",
                    })}
                    aria-current={flex === "flex-col" ? "true" : undefined}
                  >
                    <Rows3 />
                    <span className="sr-only">List view</span>
                  </Link>
                </Button>
              </div>
              <SortMenu />
            </div>
          </div>
          <FilterHint
            view={view}
            tags={tags}
            pathname={pathname}
            searchParams={searchParams}
          />
        </nav>

        <div className="flex-1">
          <section className="w-full">
            <div
              className={cn(
                "grid auto-rows-auto",
                flex === "flex-row" &&
                  "gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
                flex === "flex-col" && "gap-2 grid-cols-1",
              )}
            >
              {entities.map((entity) => (
                <Drag entity={entity} key={entity.id} flex={flex}>
                  <Drop
                    parentId={entity.id}
                    disabled={entity.entityType !== "directory"}
                  >
                    {flex === "flex-row" ? (
                      <EntityCardRow
                        entity={entity}
                        flex={flex}
                        sortBy={sortBy}
                      />
                    ) : (
                      <EntityCardCol
                        entity={entity}
                        flex={flex}
                        sortBy={sortBy}
                      />
                    )}
                  </Drop>
                </Drag>
              ))}
            </div>
          </section>
        </div>
      </main>
    </DraggingContext>
  );
}
