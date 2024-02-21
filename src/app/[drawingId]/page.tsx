import { Suspense } from "react";
import Board from "./board-edit";
import ViewBoard from "./board-view";
import { z } from "zod";
import { api } from "~/trpc/server";
import { redirect } from "next/navigation";
import { type UIAppState } from "@excalidraw/excalidraw/types/types";
import { type NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { Button } from "~/components/ui/button";
import Link from "next/link";
import { auth } from "~/server/auth";
import { PublicAccess } from "@prisma/client";

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
    const session = await auth();
    const { appState, elements, publicAccess, user } =
      await api.drawings.load.query({
        id: drawingId,
      });
    const iceServers = await api.auth.iceServers.query();
    const isOwner = session?.user?.id === user?.id;
    const hasReadAccess = publicAccess === PublicAccess.READ;
    const shouldRenderViewMode = !isOwner && hasReadAccess;

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
          fallback={<div style={{ width: "100vw", height: "100vh" }}></div>}
        >
          {!shouldRenderViewMode && (
            <Board
              iceServers={iceServers}
              drawingId={drawingId}
              elements={parsedElements}
              appState={parsedAppState}
            />
          )}
          {shouldRenderViewMode && (
            <ViewBoard
              drawingId={drawingId}
              elements={parsedElements}
              appState={parsedAppState}
            />
          )}
        </Suspense>
      </div>
    );
  } catch (error) {
    console.error("Error loading drawing:", error);
    return (
      <div className="flex h-[90vh] w-full flex-col items-center justify-center gap-4">
        <p>Something went wrong</p>
        <Link href={`/dashboard`}>
          <Button>Go to dashboard</Button>
        </Link>
      </div>
    );
  }
}
