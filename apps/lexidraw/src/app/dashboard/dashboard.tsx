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
      <nav className="flex flex-col space-x-2 px-4 md:px-8 py-2">
        <div className="flex justify-between items-center">
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
          <div className="hidden md:grid grid-cols-1 gap-4  md:grid-cols-2 lg:grid-cols-3">
            <DndMonitor refetch={refetch}>
              {entities.map((entity) => (
                <Drag entity={entity}>
                  <Drop
                    key={entity.id}
                    parentId={entity.id}
                    disabled={entity.entityType !== "directory"}
                  >
                    <Card className="relative flex flex-col gap-2 rounded-lg p-4 shadow-md">
                      <div className="flex justify-between items-center gap-4">
                        <span className="font-thin">
                          {formatDistanceToNow(new Date(entity.updatedAt), {
                            addSuffix: true,
                          })}
                        </span>
                        <MoreActions
                          entity={entity}
                          currentAccess={entity.publicAccess as PublicAccess}
                          revalidatePath={refetch}
                        />
                      </div>
                      <div className="flex w-full justify-between gap-4">
                        <EntityTitle entity={entity} revalidatePath={refetch} />
                      </div>
                      <Suspense fallback={<ThumbnailFallback />}>
                        <Thumbnail entity={entity} />
                      </Suspense>
                      <Button className="mt-2 w-full" asChild>
                        <Link
                          href={itemUrl(
                            entity.entityType as EntityType,
                            entity.id,
                          )}
                          passHref
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
          <div className="md:hidden overflow-x-auto">
            <table className="w-full rounded-lg border-collapse border-2 border-border overflow-hidden bg-muted shadow-md">
              <thead className="bg-muted"></thead>
              <tbody>
                {entities.map((entity) => (
                  <tr key={entity.id} className="border border-border">
                    <td className="py-2 px-2 align-middle min-w-[60px] max-w-[60px]">
                      <Link
                        href={itemUrl(
                          entity.entityType as EntityType,
                          entity.id,
                        )}
                      >
                        <Suspense fallback={<ThumbnailFallback />}>
                          <Thumbnail entity={entity} />
                        </Suspense>
                      </Link>
                    </td>
                    <td className="py-3 px-4 max-w-[200px] truncate font-medium">
                      <Link
                        href={itemUrl(
                          entity.entityType as EntityType,
                          entity.id,
                        )}
                      >
                        {entity.title}
                      </Link>
                    </td>
                    {/* <td className="py-3 px-4 text-muted-foreground capitalize">
                      {entity.entityType}
                    </td> */}
                    {/* <td className="py-3 px-4 text-muted-foreground">
                      {formatDistanceToNow(new Date(entity.updatedAt), {
                        addSuffix: true,
                        includeSeconds: false,
                      })
                        .replace("about ", "")
                        .replace("hours", "h")
                        .replace("minutes", "m")
                        .replace("seconds", "s")
                        .replace("less than a minute", "<1m")
                        .replace("day", "d")
                        .replace("months", "mo")}
                    </td> */}
                    <td className="py-3 px-4 text-right">
                      <MoreActions
                        entity={entity}
                        currentAccess={entity.publicAccess as PublicAccess}
                        revalidatePath={refetch}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
