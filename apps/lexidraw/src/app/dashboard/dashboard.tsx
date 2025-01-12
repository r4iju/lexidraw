import { Suspense } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import { EntityType, PublicAccess } from "@packages/types";
import { api } from "~/trpc/server";
import { RouterOutputs } from "~/trpc/shared";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import EntityTitle from "./_actions/rename-inline";
import { MoreActions } from "./_actions/more-actions";
import { Thumbnail } from "./thumbnail";
import { NewEntity } from "./_actions/new-entity";
import { ThumbnailFallback } from "./thumbnail-client";
import { Drag } from "./drag";
import { Drop } from "./drop";
import { DndMonitor } from "./dnd-monitor";
import { SortMenu } from "./sort-menu";
import { LayoutGrid, Rows3 } from "lucide-react";

type Props = {
  directory?: RouterOutputs["entities"]["getMetadata"];
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
  flex: "flex-row" | "flex-col";
};

export async function Dashboard({ directory, sortBy, sortOrder, flex }: Props) {
  const searchParams = new URLSearchParams({
    ...(flex ? { flex } : {}),
    ...(sortBy ? { sortBy } : {}),
    ...(sortOrder ? { sortOrder } : {}),
  });
  const entities = await api.entities.list.query({
    parentId: directory ? directory.id : null,
    sortBy,
    sortOrder,
  });

  const itemUrl = (kind: "drawing" | "document" | "directory", id: string) => {
    switch (kind) {
      case "drawing":
        return `/drawings/${id}`;
      case "document":
        return `/documents/${id}`;
      case "directory":
        return `/dashboard/${id}?${searchParams.toString()}`;
    }
  };

  const replaceSearchParam = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set(key, value);
    return `/dashboard${directory ? `/${directory.id}` : ""}?${newParams.toString()}`;
  };

  return (
    <main className="flex h-full flex-col overflow-auto pb-6">
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
                        className="truncate text-left hover:underline w-[fit-content] max-w-[125px]"
                      >
                        <Link
                          href={`/dashboard/${ancestor.id ?? ""}${
                            [...searchParams.entries()].length > 0
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
        <div className="flex justify-end space-x-2">
          <Button
            variant={flex === "flex-row" ? "secondary" : "outline"}
            size="icon"
            asChild
          >
            <Link href={replaceSearchParam("flex", "flex-row")}>
              <LayoutGrid />
            </Link>
          </Button>
          <Button
            variant={flex === "flex-col" ? "secondary" : "outline"}
            size="icon"
            asChild
          >
            <Link href={replaceSearchParam("flex", "flex-col")}>
              <Rows3 />
            </Link>
          </Button>
          <SortMenu sortBy={sortBy} sortOrder={sortOrder} />
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
            <DndMonitor>
              {entities.map((entity) => (
                <Drag entity={entity} key={entity.id}>
                  <Drop
                    parentId={entity.id}
                    disabled={entity.entityType !== "directory"}
                  >
                    <Card
                      className={cn(
                        "relative flex gap-4 rounded-lg p-4 hover:bg-muted/20 transition-colors duration-150 justify-between",
                        flex === "flex-row" && "flex-col",
                        flex === "flex-col" && "flex-row",
                      )}
                    >
                      <Link
                        href={itemUrl(
                          entity.entityType as EntityType,
                          entity.id,
                        )}
                      >
                        <div
                          className={cn(
                            "flex flex-row items-center gap-4",
                            flex === "flex-row" && "hidden",
                          )}
                        >
                          <div className="size-10 min-w-10">
                            <Suspense fallback={<ThumbnailFallback />}>
                              <Thumbnail entity={entity} />
                            </Suspense>
                          </div>
                          <span className="font-semibold line-clamp-1 w-full">
                            {entity.title}
                          </span>
                        </div>
                      </Link>
                      <div className="flex justify-between items-center gap-4">
                        <span
                          className={cn(
                            "text-sm text-muted-foreground hidden",
                            flex === "flex-row" && "block",
                            flex === "flex-col" && "md:block",
                          )}
                        >
                          {sortBy === "createdAt" ? "Created " : "Updated "}
                          {/* default to updatedAt, unless sortBy is createdAt */}
                          {formatDistanceToNow(
                            new Date(
                              sortBy === "createdAt"
                                ? entity.createdAt
                                : entity.updatedAt,
                            ),
                            {
                              addSuffix: true,
                            },
                          )}
                        </span>
                        <MoreActions
                          entity={entity}
                          currentAccess={entity.publicAccess as PublicAccess}
                        />
                      </div>
                      <div
                        className={cn(
                          "items-center gap-4",
                          flex === "flex-row" ? "flex flex-col" : "hidden",
                        )}
                      >
                        <EntityTitle entity={entity} />
                        <Suspense fallback={<ThumbnailFallback />}>
                          <Thumbnail entity={entity} />
                        </Suspense>
                      </div>
                      {/* only flex-row` */}
                      <Button
                        className={cn(
                          "mt-2 w-full",
                          flex === "flex-row" ? "block" : "hidden",
                        )}
                        asChild
                      >
                        <Link
                          href={itemUrl(
                            entity.entityType as EntityType,
                            entity.id,
                          )}
                        >
                          Open
                        </Link>
                      </Button>
                    </Card>
                  </Drop>
                </Drag>
              ))}
            </DndMonitor>
          </div>
        </section>
      </div>
    </main>
  );
}
