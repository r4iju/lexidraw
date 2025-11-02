"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { UnsavedChangesProvider } from "~/hooks/use-unsaved-changes";
import EditBoard from "./board-edit";

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
  const { mutate: save } = api.entities.save.useMutation();
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

    save(
      {
        id: drawing.id,
        entityType: "drawing",
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
          theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
        } satisfies AppState),
        elements: JSON.stringify(elements),
      },
      {
        onSuccess: async () => {
          toast.success("Saved", { id: TOAST_ID });
          router.push("/dashboard");
        },
        onError: (error: TRPCClientErrorLike<AppRouter>) => {
          toast.error("Error saving", {
            id: TOAST_ID,
            description: error.message,
          });
        },
      },
    );
  };

  return (
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
  );
}
