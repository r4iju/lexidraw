import { Suspense } from "react";
import Board from "./board";
import { z } from "zod";
import { api } from "~/trpc/server";
import { redirect } from "next/navigation";
import { type UIAppState } from "@excalidraw/excalidraw/types/types";
import { type NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";

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
    await api.drawings.create.mutate({ id: drawingId, title: "" });
    return redirect(`/dashboard/${drawingId}`);
  }

  const { appState, elements } = await api.drawings.load.query({
    id: drawingId,
  });
  const parsedAppState = appState?.appState
    ? (JSON.parse(appState?.appState) as UIAppState)
    : undefined;

  console.log('parsed AppState', parsedAppState)

  const parsedElements = elements?.map((element) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const properties =
      typeof element.properties === "string"
        ? JSON.parse(element.properties)
        : element.properties;

    return {
      ...properties,
      ...element,
    } as NonDeletedExcalidrawElement;
  });

  console.log('parsed Elements: ', parsedElements)

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
}
