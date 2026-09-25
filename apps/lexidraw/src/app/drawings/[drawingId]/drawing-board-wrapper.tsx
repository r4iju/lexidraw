"use client";

import { toast } from "sonner";
import type { RouterOutputs } from "~/trpc/shared";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { UnsavedChangesProvider } from "~/hooks/use-unsaved-changes";
import { OpenEntityContext, useOpenEntity } from "~/hooks/use-open-entity-sync";
import {
  EntityAppBar,
  type EntityFrame,
} from "~/components/app-bar/entity-frame";
import { ShareButton, ShareDialog } from "~/components/app-bar/share-button";
// Excalidraw touches `window` as it loads, so it must not render on the server.
import EditBoard from "./board-edit-client";

type Props = {
  revalidate: () => void;
  drawing: RouterOutputs["entities"]["load"];
  elements?: ExcalidrawElement[];
  appState?: AppState;
  iceServers: RTCIceServer[];
  frame: EntityFrame;
};

export default function DrawingBoardWithSave({
  revalidate,
  drawing,
  elements,
  appState,
  iceServers,
  frame,
}: Props) {
  const [sharing, setSharing] = useState(false);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const openDrawing = useOpenEntity(drawing, "drawing");
  const isDarkTheme = useIsDarkTheme();

  /** Saves on the way out of the editor; answers whether it landed. */
  const saveBeforeLeaving = async () => {
    // Nothing loaded, so nothing to lose.
    if (!excalidrawApiRef.current) return true;

    const elements =
      excalidrawApiRef.current.getSceneElements() as ExcalidrawElement[];
    const appState = excalidrawApiRef.current.getAppState();

    const TOAST_ID = `save-${drawing.id}`;
    toast.loading("Saving…", { id: TOAST_ID, duration: Infinity });
    try {
      const outcome = await openDrawing.sync.save({
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
          theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
        } satisfies AppState),
        elements: JSON.stringify(elements),
      });
      if (outcome === "dropped") {
        toast.dismiss(TOAST_ID);
        return false;
      }
      toast.success(`Saved “${drawing.title}”.`, { id: TOAST_ID });
      return true;
    } catch (error) {
      toast.error(`Couldn’t save “${drawing.title}”. Try again.`, {
        id: TOAST_ID,
        description: error instanceof Error ? error.message : undefined,
      });
      return false;
    }
  };

  return (
    <OpenEntityContext value={openDrawing}>
      <UnsavedChangesProvider saveBeforeLeaving={saveBeforeLeaving}>
        <EntityAppBar
          frame={frame}
          entity={drawing}
          canRename
          actions={
            frame.isOwner && <ShareButton onClick={() => setSharing(true)} />
          }
        />
        {frame.isOwner && (
          <ShareDialog
            entity={{
              id: drawing.id,
              title: drawing.title,
              entityType: drawing.entityType,
              publicAccess: drawing.publicAccess,
            }}
            open={sharing}
            onOpenChange={setSharing}
          />
        )}
        <div className="relative min-h-0 flex-1">
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
        </div>
      </UnsavedChangesProvider>
    </OpenEntityContext>
  );
}
