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
import type { Metadata, ServerRuntime } from "next";
import { ThumbnailFallback } from "./thumbnail-client";
import { Suspense } from "react";
import { DragAndDrop } from "./dragndrop";
import { RouterOutputs } from "~/trpc/shared";

export const metadata: Metadata = {
  title: "Lexidraw | Dashboard",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime: ServerRuntime = "edge";

type Props = {
  directory?: RouterOutputs["entities"]["getMetadata"];
};

export async function Dashboard({ directory }: Props) {
  const entities = await api.entities.list.query({
    parentId: directory ? directory.id : null,
  });

  const itemUrl = (kind: "drawing" | "document" | "directory", id: string) => {
    switch (kind) {
      case "drawing":
        return `/drawings/${id}`;
      case "document":
        return `/documents/${id}`;
      case "directory":
        return `/dashboard/${id}`;
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
      <div className="flex items-center justify-between p-4 lg:p-6">
        <h1 className="text-xl font-bold">
          Drawings and documents {directory && ` | ${directory.title}`}
        </h1>
        <NewEntity parentId={directory ? directory.id : null} />
      </div>
      <div className="flex-1  md:container">
        <section className="w-full p-4">
          <div className="grid grid-cols-1 gap-4  md:grid-cols-2 lg:grid-cols-3">
            {entities.map((entity) => (
              <DragAndDrop key={entity.id} entity={entity}>
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
                      href={itemUrl(entity.entityType as EntityType, entity.id)}
                      passHref
                    >
                      Open
                    </Link>
                  </Button>
                </Card>
              </DragAndDrop>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
