import Board from "./board-edit";
import ViewBoard from "./board-view";
import { z } from "zod";
import { api } from "~/trpc/server";
import { redirect } from "next/navigation";
import type { AppState } from "@excalidraw/excalidraw/types/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { Button } from "~/components/ui/button";
import Link from "next/link";
import { AccessLevel } from "@packages/db";

export const dynamic = "force-dynamic";

const Params = z.object({
  params: z.object({
    drawingId: z.string(),
  }),
  searchParams: z.object({
    new: z.string().optional(),
  }),
});

type Props = z.infer<typeof Params>;

export default async function DrawingBoard(props: Props) {
  const {
    params: { drawingId },
    searchParams,
  } = Params.parse(props);

  if (searchParams.new) {
    try {
      await api.drawings.create.mutate({ id: drawingId, title: "New drawing" });
      return redirect(`/${drawingId}`);
    } catch (error) {
      console.error("Error creating a new drawing:", error);
      return redirect(`/${drawingId}`);
    }
  }

  try {
    const drawing = await api.drawings.load.query({ id: drawingId });

    console.log("typeof appstate: ", typeof drawing.appState);
    console.log("appstate: ", drawing.appState);
    const parsedAppState = drawing.appState
      ? (drawing.appState as unknown as AppState)
      : undefined;

    const parsedElements = drawing.elements
      ? (drawing.elements as unknown as ExcalidrawElement[])
      : undefined;

    return (
      <div className="flex w-full items-center justify-center">
        {drawing.accessLevel === AccessLevel.EDIT && (
          <Board
            drawing={drawing}
            elements={parsedElements}
            appState={parsedAppState}
          />
        )}
        {drawing.accessLevel === AccessLevel.READ && (
          <ViewBoard
            drawing={drawing}
            elements={parsedElements}
            appState={parsedAppState}
          />
        )}
      </div>
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error?.message : "Something went wrong";
    console.error("Error loading drawing:", errorMessage);
    return (
      <div className="flex h-[90vh] w-full flex-col items-center justify-center gap-4">
        <p className="text-lg">Something went wrong</p>
        <p>{errorMessage}</p>
        <Link href={`/dashboard`}>
          <Button>Go to dashboard</Button>
        </Link>
      </div>
    );
  }
}
