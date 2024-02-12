import Link from "next/link";
import { Button } from "~/components/ui/button";
import { v4 as uuidv4 } from "uuid";
import { api } from "~/trpc/server";
import { Card } from "~/components/ui/card";
import { revalidatePath } from "next/cache";
import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
import DeleteDrawing from "./_actions/delete-drawing";
import DrawingTitle from "./_actions/rename-drawing";

export const metadata = {
  title: "An Excalidraw App | My drawings",
  description:
    "This is a demo of the excalidraw tool. It is a collaborative online drawing and diagramming tool.",
};

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const drawings = await api.drawings.list.query();
  const newDrawingUrl = () => {
    return `/dashboard/${uuidv4()}?new=true`;
  };

  const refetch = async () => {
    "use server";
    revalidatePath("/dashboard");
  };

  return (
    <div className="flex min-h-[90vh] flex-col ">
      <header className="flex items-center justify-between p-4 lg:p-6">
        <h1 className="text-xl font-bold">My Drawings</h1>
        <Link href={newDrawingUrl()} passHref>
          <Button>New drawing</Button>
        </Link>
      </header>
      <main className="container flex-1">
        <section className="w-full p-4">
          <div className="grid grid-cols-1 gap-4  md:grid-cols-2 lg:grid-cols-3">
            {drawings.map((drawing) => (
              <Card
                key={drawing.id}
                className="relative flex flex-col gap-2 rounded-lg p-4 shadow-md"
              >
                <div className="text-right text-sm text-gray-500 dark:text-gray-400">
                  {formatDistanceToNow(new Date(drawing.updatedAt), {
                    addSuffix: true,
                  })}
                </div>
                <div className="right-2 top-2 flex justify-between gap-4">
                  <DrawingTitle
                    drawingId={drawing.id}
                    title={drawing.title}
                    onTitleChange={refetch}
                  />
                  <DeleteDrawing
                    drawingId={drawing.id}
                    revalidatePath={refetch}
                  />
                </div>
                <Link href={`/dashboard/${drawing.id}`} passHref>
                  <Button className="mt-2 w-full">Open</Button>
                </Link>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
