import Link from "next/link";
import { api } from "~/trpc/server";
import type { RouterOutputs } from "~/trpc/shared";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { NewEntity } from "./_actions/new-entity";
import { Drag } from "./drag";
import { Drop } from "./drop";
import { SortMenu } from "./sort-menu";
import { Archive, Heart, LayoutGrid, Rows3 } from "lucide-react";
import { DraggingContext } from "./dnd-context";
import { EntityCard } from "./entity-card";
import { replaceSearchParam } from "./utils";
import { FilterByTags } from "./filter-by-tags";
import { SearchBar } from "./search";
import { PersistDashboardPrefsCookie } from "./persist-dashboard-prefs-cookie";
import { CanonicalizeDashboardURL } from "./canonicalize-dashboard-url";

type Props = {
  directory?: RouterOutputs["entities"]["getMetadata"];
  sortBy: "updatedAt" | "createdAt" | "title";
  sortOrder: "asc" | "desc";
  flex: "flex-row" | "flex-col";
  tags?: string;
  includeArchived?: boolean;
  onlyFavorites?: boolean;
};

export async function Dashboard({
  directory,
  sortBy,
  sortOrder,
  flex,
  tags,
  includeArchived = false,
  onlyFavorites = false,
}: Props) {
  const searchParams = new URLSearchParams({
    ...(flex ? { flex } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortOrder ? { sortOrder } : {}),
    ...(tags ? { tags } : {}),
    ...(includeArchived ? { includeArchived: String(includeArchived) } : {}),
    ...(onlyFavorites ? { onlyFavorites: String(onlyFavorites) } : {}),
  });
  const entities = await api.entities.list.query({
    parentId: directory ? directory.id : null,
    sortBy,
    sortOrder,
    tagNames: tags ? tags.split(",").filter(Boolean) : [],
    includeArchived,
    onlyFavorites,
  });

  const llmConfig = await api.auth.getLlmConfig.query();
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
          includeArchived,
          onlyFavorites,
        }}
      />
      <main className="flex size-full min-h-0 flex-col overflow-auto pb-6 px-4">
        {/* Breadcrumb: each ancestor is droppable */}
        <nav className="flex flex-col  py-2 gap-y-2 md:container">
          <div className="flex justify-between items-center ">
            <div className="flex items-center space-x-2 truncate">
              {directory && directory.ancestors?.length > 0 ? (
                <>
                  {directory.ancestors.map((ancestor, index) => (
                    <div
                      key={ancestor.id}
                      className="flex items-center space-x-2 "
                    >
                      <Drop parentId={ancestor.id}>
                        <Button
                          asChild
                          variant="link"
                          size="icon"
                          className="truncate text-left hover:underline w-[fit-content] max-w-[125px] text-primary"
                        >
                          <Link
                            href={`/dashboard/${ancestor.id ?? ""}${
                              searchParams.size > 0
                                ? `?${searchParams.toString()}`
                                : ""
                            }`}
                          >
                            {ancestor.title ?? "Untitled"}
                          </Link>
                        </Button>
                      </Drop>
                      {index < directory.ancestors.length && (
                        <span className="text-muted-foreground">/</span>
                      )}
                    </div>
                  ))}
                  <span className="font-semibold truncate">
                    {directory.title}
                  </span>
                </>
              ) : (
                <span>Root</span>
              )}
            </div>
            <NewEntity parentId={directory ? directory.id : null} />
          </div>
          <div className="flex flex-col-reverse md:flex-col-reverse items-stretch gap-2">
            {/* but dont cannibalize the search the buttons */}
            <SearchBar className="w-full" />
            <div className="flex flex-wrap justify-end gap-x-2 gap-y-2 w-full md:w-auto md:self-end">
              {/* filter by tags */}

              <FilterByTags options={allTags} />

              {/* favorites / archived toggles */}
              <div className="flex gap-2">
                <Button
                  variant={onlyFavorites ? "secondary" : "outline"}
                  size="icon"
                  asChild
                  className="md:min-w-20"
                >
                  <Link
                    href={replaceSearchParam({
                      pathname: `/dashboard/${directory?.id ?? ""}`,
                      prevParams: searchParams,
                      key: "onlyFavorites",
                      value: onlyFavorites ? "false" : "true",
                    })}
                  >
                    <Heart className="md:hidden" />
                    <span className="hidden md:block">Favorites</span>
                  </Link>
                </Button>
                <Button
                  variant={includeArchived ? "secondary" : "outline"}
                  size="icon"
                  asChild
                  className="md:min-w-20"
                >
                  <Link
                    href={replaceSearchParam({
                      pathname: `/dashboard/${directory?.id ?? ""}`,
                      prevParams: searchParams,
                      key: "includeArchived",
                      value: includeArchived ? "false" : "true",
                    })}
                  >
                    <Archive className="md:hidden" />
                    <span className="hidden md:block">Archived</span>
                  </Link>
                </Button>
              </div>

              <div className="flex gap-2">
                <Button
                  variant={flex === "flex-row" ? "secondary" : "outline"}
                  size="icon"
                  asChild
                >
                  <Link
                    href={replaceSearchParam({
                      pathname: `/dashboard/${directory?.id ?? ""}`,
                      prevParams: searchParams,
                      key: "flex",
                      value: "flex-row",
                    })}
                  >
                    <LayoutGrid />
                  </Link>
                </Button>
                <Button
                  variant={flex === "flex-col" ? "secondary" : "outline"}
                  size="icon"
                  asChild
                >
                  <Link
                    href={replaceSearchParam({
                      pathname: `/dashboard/${directory?.id ?? ""}`,
                      prevParams: searchParams,
                      key: "flex",
                      value: "flex-col",
                    })}
                  >
                    <Rows3 />
                  </Link>
                </Button>
              </div>
              <SortMenu />
            </div>
          </div>
        </nav>

        <div className="flex-1 md:container">
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
                    <EntityCard
                      entity={entity}
                      flex={flex}
                      sortBy={sortBy}
                      llmConfig={llmConfig}
                    />
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
