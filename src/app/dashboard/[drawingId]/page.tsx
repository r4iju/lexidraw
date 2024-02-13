import { Suspense } from "react";
import Board from "./board";
import { z } from "zod";
import { api } from "~/trpc/server";
import { redirect } from "next/navigation";
import { type UIAppState } from "@excalidraw/excalidraw/types/types";
import { type NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { v4 as uuidv4 } from "uuid";
import { Button } from "~/components/ui/button";
import Link from "next/link";

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
      return redirect(`/dashboard/${drawingId}`);
    } catch (error) {
      console.error("Error creating a new drawing:", error);
      return redirect(`/dashboard/${drawingId}`);
    }
  }

  try {
    const { appState, elements } = await api.drawings.load.query({
      id: drawingId,
    });

    const parsedAppState = appState?.appState
      ? (JSON.parse(appState.appState) as UIAppState)
      : undefined;

    const parsedElements = elements.map((element) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const properties =
        typeof element.properties === "string"
          ? JSON.parse(element.properties)
          : element.properties;
      return { ...element, ...properties } as NonDeletedExcalidrawElement;
    });

    return (
      <div className="flex w-full items-center justify-center">
        <Suspense
          fallback={<div style={{ width: "100vw", height: "90vh" }}></div>}
        >
          <Board
            drawingId={drawingId}
            elements={parsedElements}
            appState={parsedAppState}
          />
        </Suspense>
      </div>
    );
  } catch (error) {
    console.error("Error loading drawing:", error);
    <div className="flex w-full items-center justify-center">
      <p>Something went wrong</p>
      <Link href={`/dashboard/${uuidv4()}?new=true`}>
        <Button>Try again</Button>
      </Link>
    </div>;
  }
}
