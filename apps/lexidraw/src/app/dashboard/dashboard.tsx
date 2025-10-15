import Link from "next/link";
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
import { EntityCard } from "./entity-card";
import { replaceSearchParam } from "./utils";
import { FilterByTags } from "./filter-by-tags";
import { SearchBar } from "./search";

type Props = {
  directory?: RouterOutputs["entities"]["getMetadata"];
  sortBy: "updatedAt" | "createdAt" | "title";
  sortOrder: "asc" | "desc";
  flex: "flex-row" | "flex-col";
  tags?: string;
};

export async function Dashboard({
  directory,
  sortBy,
  sortOrder,
  flex,
  tags,
}: Props) {
  const searchParams = new URLSearchParams({
    ...(flex ? { flex } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortOrder ? { sortOrder } : {}),
    ...(tags ? { tags } : {}),
  });
  const entities = await api.entities.list.query({
    parentId: directory ? directory.id : null,
    sortBy,
    sortOrder,
    tagNames: tags ? tags.split(",").filter(Boolean) : [],
  });

  const llmConfig = await api.auth.getLlmConfig.query();
  const allTags = await api.entities.getUserTags.query();

  return (
    <DraggingContext sortBy={sortBy} sortOrder={sortOrder} flex={flex}>
      <main className="flex size-full min-h-0 flex-col overflow-auto pb-6">
        {/* Breadcrumb: each ancestor is droppable */}
        <nav className="flex flex-col space-x-2 px-4 md:px-8 py-2 gap-y-4">
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
          <div className="flex flex-col-reverse md:flex-row justify-between items-center gap-2 md:gap-6">
            {/* but dont cannibalize the search the buttons */}
            <SearchBar className="w-full" />
            <div className="flex justify-end space-x-2 w-full md:w-auto">
              {/* filter by tags */}

              <FilterByTags options={allTags} />

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
              <SortMenu />
            </div>
          </div>
        </nav>

        <div className="flex-1 md:container">
          <section className="w-full p-4">
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
