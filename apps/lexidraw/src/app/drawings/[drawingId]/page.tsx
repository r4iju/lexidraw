import Link from "next/link";
import { z } from "zod";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { AccessLevel } from "@packages/types";
import { api } from "~/trpc/server";
import { Button } from "~/components/ui/button";
import type { Metadata, ServerRuntime } from "next";
import { revalidatePath } from "next/cache";
import EditBoard from "./board-edit-client";
import ViewBoard from "./board-view-client";
import { redirect } from "next/navigation";
import { UnsavedChangesProvider } from "~/hooks/use-unsaved-changes";

export const runtime: ServerRuntime = "nodejs";
export const fetchCache = "force-no-store";
export const dynamic = "force-dynamic";

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
    const drawing = await api.entities.load.query({ id: drawingId });
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
      <div className="flex w-full items-center justify-center">
        {drawing.accessLevel === AccessLevel.EDIT && (
          <UnsavedChangesProvider>
            <EditBoard
              revalidate={revalidate}
              drawing={drawing}
              elements={parsedElements}
              appState={parsedAppState}
              iceServers={iceServers}
            />
          </UnsavedChangesProvider>
        )}
        {drawing.accessLevel === AccessLevel.READ && (
          <ViewBoard
            revalidate={revalidate}
            drawing={drawing}
            elements={parsedElements}
            appState={parsedAppState}
          />
        )}
      </div>
    );
  } catch (error) {
    console.error(error);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-lg">Something went wrong</p>
        <Button asChild>
          <Link href={`/dashboard`}>Go to dashboard</Link>
        </Button>
      </div>
    );
  }
}
