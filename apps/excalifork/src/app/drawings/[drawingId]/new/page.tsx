// this could be served with a dialog instead of a full page

import { z } from "zod";
import { api } from "~/trpc/server";
import { Button } from "~/components/ui/button";
import Link from "next/link";
import Redirect from "./redirect";

export const runtime = "edge";
export const fetchCache = "force-no-store";

const Params = z.object({
  params: z.object({
    drawingId: z.string(),
  }),
});

type Props = z.infer<typeof Params>;

export default async function DrawingBoard(props: Props) {
  const {
    params: { drawingId },
  } = Params.parse(props);

  try {
    await api.drawings.create.mutate({ id: drawingId, title: "New drawing" });
    return (
      <>
        <Redirect drawingId={drawingId} />
      </>
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "An error occurred";
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-lg">Something went wrong</p>
        <p>{errorMessage}</p>
        <Link href={`/dashboard`}>
          <Button>Go to dashboard</Button>
        </Link>
      </div>
    );
  }
}
