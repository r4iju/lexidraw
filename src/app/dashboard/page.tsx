import Link from "next/link";
import { Button } from "~/components/ui/button";
import { v4 as uuidv4 } from "uuid";
import { api } from "~/trpc/server";
import { Card } from "~/components/ui/card";
import { revalidatePath } from "next/cache";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import DrawingTitle from "./_actions/rename-drawing";
import { MoreActions } from "./_actions/more-actions";
import { Thumbnail } from "./thumbnail";
import { Suspense } from "react";
import { FilePlusIcon } from "@radix-ui/react-icons";

export const metadata = {
  title: "An Excalidraw App | My drawings",
  description:
    "This is a demo of the excalidraw tool. It is a collaborative online drawing and diagramming tool.",
};

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const drawings = await api.drawings.list.query();
  const newDrawingUrl = () => {
    return `/${uuidv4()}?new=true`;
  };

  const refetch = async () => {
    "use server";
    revalidatePath("/dashboard");
  };

  return (
    <Suspense fallback={<div className="flex min-h-[90vh] flex-col"></div>}>
      <div className="flex min-h-[90vh] flex-col ">
        <header className="flex items-center justify-between p-4 lg:p-6">
          <h1 className="text-xl font-bold">My Drawings</h1>
          <Link href={newDrawingUrl()} passHref>
            <Button>
              <FilePlusIcon className="mr-4" />
              New drawing
            </Button>
          </Link>
        </header>
        <main className="flex-1 md:container">
          <section className="w-full p-4">
            <div className="grid grid-cols-1 gap-4  md:grid-cols-2 lg:grid-cols-3">
              {drawings.map((drawing) => (
                <Card
                  key={drawing.id}
                  className="relative flex flex-col gap-2 rounded-lg p-4 shadow-md"
                >
                  <div className="right flex justify-end gap-4">
                    <div className="text-right text-sm text-gray-500 dark:text-gray-300">
                      {formatDistanceToNow(new Date(drawing.updatedAt), {
                        addSuffix: true,
                      })}
                    </div>
                    <MoreActions
                      drawing={drawing}
                      currentAccess={drawing.publicAccess}
                      revalidatePath={refetch}
                    />
                  </div>
                  <div className="flex w-full justify-between gap-4">
                    <DrawingTitle
                      drawingId={drawing.id}
                      title={drawing.title}
                      onTitleChange={refetch}
                    />
                  </div>
                  <Thumbnail drawingId={drawing.id} />
                  <Link href={`/${drawing.id}`} passHref>
                    <Button className="mt-2 w-full">Open</Button>
                  </Link>
                </Card>
              ))}
            </div>
          </section>
        </main>
      </div>
    </Suspense>
  );
}
