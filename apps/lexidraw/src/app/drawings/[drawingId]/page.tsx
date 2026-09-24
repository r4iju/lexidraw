"use cache: private";

import Link from "next/link";
import { z } from "zod";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { AccessLevel } from "@packages/types";
import { entityTag } from "~/server/api/entity-cache";
import { api } from "~/trpc/server";
import { notFoundOr } from "~/trpc/not-found";
import { Button } from "~/components/ui/button";
import type { Metadata } from "next";
import { cacheTag, revalidatePath } from "next/cache";
import DrawingBoardWithSave from "./drawing-board-wrapper";
import ViewBoard from "./board-view-client";
import { unstable_rethrow } from "next/navigation";
import { appBarAccount, entityFrame } from "~/server/app-bar-account";
import { EntityAppBar } from "~/components/app-bar/entity-frame";
import { AppBar } from "~/components/app-bar/app-bar";

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { drawingId } = await props.params;
  cacheTag(entityTag(drawingId));
  const drawing = await api.entities.getMetadata
    .query({ id: drawingId })
    .catch(() => null);
  return {
    title: drawing?.title || "Drawing",
    appleWebApp: { capable: true, statusBarStyle: "black", title: "Lexidraw" },
  };
}

const Params = z.object({
  drawingId: z.string(),
});

type Props = {
  params: Promise<z.infer<typeof Params>>;
};

export default async function DrawingBoard(props: Props) {
  const { drawingId } = Params.parse(await props.params);

  // What this render is about, so a write to it anywhere — the browser, the
  // REST path, MCP, the CLI — drops this entry instead of leaving a stale
  // drawing on screen until it expires.
  cacheTag(entityTag(drawingId));

  try {
    const [drawing, iceServers, frame] = await Promise.all([
      api.entities.load.query({ id: drawingId }).catch(notFoundOr),
      api.auth.iceServers.query(),
      entityFrame(drawingId),
    ]);

    const revalidate = async () => {
      "use server";
      revalidatePath(`/drawings/${drawing.id}`, "page");
    };

    const parsedAppState = drawing.appState
      ? (JSON.parse(drawing.appState) as unknown as AppState)
      : undefined;

    const parsedElements = drawing.elements
      ? (JSON.parse(drawing.elements) as unknown as ExcalidrawElement[]).map(
          (el) => {
            if (
              ["freedraw", "line", "arrow"].includes(el.type) &&
              !("points" in el)
            ) {
              return {
                ...(el as unknown as ExcalidrawElement),
                points: [] as const,
              };
            }
            return el;
          },
        )
      : undefined;

    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 w-full flex-1 flex-col"
      >
        {drawing.accessLevel === AccessLevel.EDIT && (
          <DrawingBoardWithSave
            revalidate={revalidate}
            drawing={drawing}
            elements={parsedElements}
            appState={parsedAppState}
            iceServers={iceServers}
            frame={frame}
          />
        )}
        {drawing.accessLevel === AccessLevel.READ && (
          <>
            <EntityAppBar frame={frame} entity={drawing} canRename={false} />
            <div className="relative min-h-0 flex-1">
              <ViewBoard
                revalidate={revalidate}
                drawing={drawing}
                elements={parsedElements}
                appState={parsedAppState}
              />
            </div>
          </>
        )}
      </main>
    );
  } catch (error) {
    // The 404 for a missing drawing is Next's to render, not a failure.
    unstable_rethrow(error);
    console.error(error);
    return (
      <>
        <AppBar account={await appBarAccount().catch(() => null)} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex w-full flex-1 flex-col items-center justify-center gap-2 px-4 text-center"
        >
          <h1 className="text-title font-semibold">
            This drawing couldn&apos;t be opened
          </h1>
          <p className="text-muted-foreground">
            It may have been deleted, or you no longer have access.
          </p>
          <Button asChild className="mt-4">
            <Link href="/dashboard">Back to Home</Link>
          </Button>
        </main>
      </>
    );
  }
}
