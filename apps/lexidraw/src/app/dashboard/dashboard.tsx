import Link from "next/link";
import { revalidatePath } from "next/cache";
import { api } from "~/trpc/server";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import EntityTitle from "./_actions/rename-entity";
import { MoreActions } from "./_actions/more-actions";
import { Thumbnail } from "./thumbnail";
import { EntityType, PublicAccess } from "@packages/types";
import { NewEntity } from "./_actions/new-entity";
import { ThumbnailFallback } from "./thumbnail-client";
import { Suspense } from "react";
import { Drag } from "./drag";
import { Drop } from "./drop";
import { RouterOutputs } from "~/trpc/shared";
import { DndMonitor } from "./dnd-monitor";
import { SortMenu } from "./sort-menu";

type Props = {
  directory?: RouterOutputs["entities"]["getMetadata"];
  sortBy?: "updatedAt" | "createdAt" | "title";
  sortOrder?: "asc" | "desc";
};

export async function Dashboard({ directory, sortBy, sortOrder }: Props) {
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
        return `/dashboard/${id}?sortBy=${sortBy}&sortOrder=${sortOrder}`;
    }
  };

  const refetch = async () => {
    "use server";
    return await new Promise<void>((resolve) => {
      revalidatePath("/dashboard", "page");
      resolve();
    });
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
                        <Link href={`/dashboard/${ancestor.id ?? ""}`}>
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
                  {directory.title || "Untitled"}
                </span>
              </>
            ) : (
              <span>Root</span>
            )}
          </div>
          <NewEntity parentId={directory ? directory.id : null} />
        </div>
        <SortMenu sortBy={sortBy} sortOrder={sortOrder} />
      </nav>

      {/* Example: top bar for dropping back to the grandparent */}
      <div className="flex-1 md:container">
        <section className="w-full p-4">
          <div className="grid gap-2 md:gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-auto">
            <DndMonitor refetch={refetch}>
              {entities.map((entity) => (
                <Drag entity={entity} key={entity.id}>
                  <Drop
                    parentId={entity.id}
                    disabled={entity.entityType !== "directory"}
                  >
                    <Card className="relative flex flex-row md:flex-col gap-4 rounded-lg p-4 hover:bg-muted/20 transition-colors duration-150 justify-between">
                      <Link
                        href={itemUrl(
                          entity.entityType as EntityType,
                          entity.id,
                        )}
                      >
                        <div className="flex md:hidden flex-row items-center gap-4">
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
                        <span className="text-sm text-muted-foreground hidden md:block">
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
                          revalidatePath={refetch}
                        />
                      </div>
                      <div className="hidden md:flex flex-col items-center gap-4">
                        <EntityTitle entity={entity} revalidatePath={refetch} />
                        <Suspense fallback={<ThumbnailFallback />}>
                          <Thumbnail entity={entity} />
                        </Suspense>
                      </div>
                      <Button className="hidden md:block mt-2 w-full" asChild>
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
