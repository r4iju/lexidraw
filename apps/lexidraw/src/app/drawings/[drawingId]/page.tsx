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
import { redirect, unstable_rethrow } from "next/navigation";

export const metadata: Metadata = {
  title: "Lexidraw | drawing",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "Lexidraw",
  },
};

const Params = z.object({
  drawingId: z.string(),
});

const SearchParams = z.object({
  new: z.literal("true").optional(),
  parentId: z.string().optional(),
});

type Props = {
  params: Promise<z.infer<typeof Params>>;
  searchParams: Promise<{
    new?: "true";
    parentId?: string;
  }>;
};

export default async function DrawingBoard(props: Props) {
  const [param, search] = await Promise.all([props.params, props.searchParams]);
  const { drawingId } = Params.parse(param);
  const { new: isNew, parentId } = SearchParams.parse(search);

  // What this render is about, so a write to it anywhere — the browser, the
  // REST path, MCP, the CLI — drops this entry instead of leaving a stale
  // drawing on screen until it expires.
  cacheTag(entityTag(drawingId));

  if (isNew === "true") {
    await api.entities.create.mutate({
      id: drawingId,
      title: "New drawing",
      elements: "[]",
      entityType: "drawing",
      parentId: parentId ?? null,
    });
    return redirect(`/drawings/${drawingId}`);
  }

  try {
    const drawing = await api.entities.load
      .query({ id: drawingId })
      .catch(notFoundOr);
    const iceServers = await api.auth.iceServers.query();

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
        className="flex w-full items-center justify-center"
      >
        {drawing.accessLevel === AccessLevel.EDIT && (
          <DrawingBoardWithSave
            revalidate={revalidate}
            drawing={drawing}
            elements={parsedElements}
            appState={parsedAppState}
            iceServers={iceServers}
          />
        )}
        {drawing.accessLevel === AccessLevel.READ && (
          <ViewBoard
            revalidate={revalidate}
            drawing={drawing}
            elements={parsedElements}
            appState={parsedAppState}
          />
        )}
      </main>
    );
  } catch (error) {
    // The 404 for a missing drawing is Next's to render, not a failure.
    unstable_rethrow(error);
    console.error(error);
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="flex h-full w-full flex-col items-center justify-center gap-4"
      >
        <p className="text-lg">Something went wrong</p>
        <Button asChild>
          <Link href={`/dashboard`}>Go to dashboard</Link>
        </Button>
      </main>
    );
  }
}
