"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { RouterOutputs } from "~/trpc/shared";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { UnsavedChangesProvider } from "~/hooks/use-unsaved-changes";
import { OpenEntityContext, useOpenEntity } from "~/hooks/use-open-entity-sync";
// Excalidraw touches `window` as it loads, so it must not render on the server.
import EditBoard from "./board-edit-client";

type Props = {
  revalidate: () => void;
  drawing: RouterOutputs["entities"]["load"];
  elements?: ExcalidrawElement[];
  appState?: AppState;
  iceServers: RTCIceServer[];
};

export default function DrawingBoardWithSave({
  revalidate,
  drawing,
  elements,
  appState,
  iceServers,
}: Props) {
  const router = useRouter();
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const openDrawing = useOpenEntity(drawing, "drawing");
  const isDarkTheme = useIsDarkTheme();

  const handleSaveAndLeave = () => {
    if (!excalidrawApiRef.current) {
      // If API is not available, just navigate (might be loading)
      router.push("/dashboard");
      return;
    }

    const elements =
      excalidrawApiRef.current.getSceneElements() as ExcalidrawElement[];
    const appState = excalidrawApiRef.current.getAppState();

    const TOAST_ID = `save-${drawing.id}`;
    toast.loading("Saving…", { id: TOAST_ID, duration: Infinity });

    openDrawing.sync
      .save({
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
          theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
        } satisfies AppState),
        elements: JSON.stringify(elements),
      })
      .then(
        (outcome) => {
          if (outcome === "dropped") {
            toast.dismiss(TOAST_ID);
            return;
          }
          toast.success("Saved", { id: TOAST_ID });
          router.push("/dashboard");
        },
        (error: Error) => {
          toast.error("Error saving", {
            id: TOAST_ID,
            description: error.message,
          });
        },
      );
  };

  return (
    <OpenEntityContext value={openDrawing}>
      <UnsavedChangesProvider onSaveAndLeave={handleSaveAndLeave}>
        <EditBoard
          revalidate={revalidate}
          drawing={drawing}
          elements={elements}
          appState={appState}
          iceServers={iceServers}
          onExcalidrawApiReady={(api) => {
            excalidrawApiRef.current = api;
          }}
        />
      </UnsavedChangesProvider>
    </OpenEntityContext>
  );
}
