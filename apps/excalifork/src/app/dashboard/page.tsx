import { Suspense } from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { api } from "~/trpc/server";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import EntityTitle from "./_actions/rename-entity";
import { MoreActions } from "./_actions/more-actions";
import { Thumbnail } from "./thumbnail";
import { FilePlusIcon } from "@radix-ui/react-icons";
import { EntityType, PublicAccess } from "@packages/types";
import { NewEntity } from "./_actions/new-entity";
import Image from "next/image";

export const metadata = {
  title: "An Excalidraw App | My drawings",
  description:
    "This is a demo of the excalidraw tool. It is a collaborative online drawing and diagramming tool.",
};

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "edge";

export default async function LandingPage() {
  const entities = await api.entities.list.query();

  const itemUrl = (kind: "drawing" | "document", id: string) => {
    switch (kind) {
      case "drawing":
        return `/drawings/${id}`;
      case "document":
        return `/documents/${id}`;
    }
  };

  const refetch = async () => {
    "use server";
    revalidatePath("/dashboard");
  };

  return (
    <main className="flex h-full flex-col overflow-auto pb-6">
      <div className="flex items-center justify-between p-4 lg:p-6">
        <h1 className="text-xl font-bold">My Drawings</h1>
        <NewEntity />
      </div>
      <div className="flex-1  md:container">
        <section className="w-full p-4">
          <div className="grid grid-cols-1 gap-4  md:grid-cols-2 lg:grid-cols-3">
            {entities.map((entity) => (
              <Card
                key={entity.id}
                className="relative flex flex-col gap-2 rounded-lg p-4 shadow-md"
              >
                <div className="right flex justify-end gap-4">
                  <div className="text-right text-sm text-gray-500 dark:text-gray-300">
                    {formatDistanceToNow(new Date(entity.updatedAt), {
                      addSuffix: true,
                    })}
                  </div>
                  <MoreActions
                    entity={entity}
                    currentAccess={entity.publicAccess as PublicAccess}
                    revalidatePath={refetch}
                  />
                </div>
                <div className="flex w-full justify-between gap-4">
                  <EntityTitle
                    drawingId={entity.id}
                    title={entity.title}
                    onTitleChange={refetch}
                  />
                </div>
                <Thumbnail entityId={entity.id} />
                <Button className="mt-2 w-full" asChild>
                  <Link
                    href={itemUrl(entity.entityType as EntityType, entity.id)}
                    passHref
                  >
                    Open
                  </Link>
                </Button>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
