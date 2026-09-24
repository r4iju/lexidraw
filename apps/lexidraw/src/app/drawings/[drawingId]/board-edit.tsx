"use client";

import "@excalidraw/excalidraw/index.css";

import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  SocketId,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  BinaryFiles,
  Collaborator,
} from "@excalidraw/excalidraw/types";
import type { RouterOutputs } from "~/trpc/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import { debounce } from "@packages/lib";
import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import { Theme, type MessageStructure } from "@packages/types";
import { DrawingBoardMenu } from "./dropdown";
import { useUnsavedChanges } from "~/hooks/use-unsaved-changes";
import { useAutoSave } from "~/hooks/use-auto-save";
import {
  useOpenEntityContext,
  useOpenEntitySync,
} from "~/hooks/use-open-entity-sync";
import { useSyncedExcalidraw } from "./use-synced-excalidraw";
import { useFitOnOpen } from "./use-fit-on-open";
import { useSaveShortcut } from "~/hooks/use-save-shortcut";
import { toast } from "sonner";

type Props = {
  revalidate: () => void;
  drawing: RouterOutputs["entities"]["load"];
  appState?: AppState;
  elements?: NonDeletedExcalidrawElement[];
  iceServers: RTCIceServer[];
  onExcalidrawApiReady?: (api: ExcalidrawImperativeAPI) => void;
};

const ExcalidrawWrapper: React.FC<Props> = ({
  drawing,
  appState,
  elements,
  iceServers,
  onExcalidrawApiReady,
}) => {
  const isDarkTheme = useIsDarkTheme();
  const userId = useUserIdOrGuestId();
  const [excalidrawApi, setExcalidrawApi] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const openDrawing = useOpenEntityContext();
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);
  const canCollaborate = useMemo(() => {
    return drawing.publicAccess !== "PRIVATE" || drawing.sharedWith.length > 0;
  }, [drawing.publicAccess, drawing.sharedWith]);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const prevElementsRef = useRef(
    new Map<string, ExcalidrawElement>(elements?.map((e) => [e.id, e])),
  );
  const { markDirty, markPristine } = useUnsavedChanges();
  const { enabled: autoSaveEnabled } = useAutoSave();
  const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null);

  const updateElementsRef = useCallback(
    (currentElements: Map<string, ExcalidrawElement>) => {
      prevElementsRef.current = currentElements;
    },
    [],
  );

  const onSyncReplace = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      // The stored scene is what the editor shows now: a save still waiting
      // would write it back over whatever lands next.
      debouncedSaveRef.current?.cancel();
      updateElementsRef(new Map(elements.map((e) => [e.id, e])));
      markPristine();
    },
    [updateElementsRef, markPristine],
  );
  const { editor: syncedEditor, needsSave } = useSyncedExcalidraw(
    excalidrawApi,
    onSyncReplace,
  );
  const onSavesResumed = useCallback(() => {
    // Autosave held the edits while the question stood; without autosave
    // they stay for the user to save.
    const saveLater = debouncedSaveRef.current;
    if (!excalidrawApi || !saveLater) return;
    const elements = excalidrawApi.getSceneElementsIncludingDeleted();
    const appState = excalidrawApi.getAppState();
    if (needsSave(elements, appState)) saveLater({ elements, appState });
  }, [excalidrawApi, needsSave]);
  const { holdsSaves } = useOpenEntitySync(openDrawing, {
    editor: syncedEditor,
    onSavesResumed,
  });

  const applyUpdate = useCallback(
    ({ elements }: { elements: readonly ExcalidrawElement[] }) => {
      if (!excalidrawApi) return;
      excalidrawApi.updateScene({ elements });
      setIsRemoteUpdate(true);
      const currentElements = excalidrawApi.getSceneElements();
      updateElementsRef(new Map(currentElements.map((e) => [e.id, e])));
    },
    [excalidrawApi, updateElementsRef],
  );

  const handleMessage = useCallback(
    (message: MessageStructure) => {
      switch (message.type) {
        case "update":
          if (message.entityType === "drawing") {
            applyUpdate(message.payload);
          }
          break;
      }
    },
    [applyUpdate],
  );

  const {
    sendMessage,
    initializeConnection,
    connected: peersConnected,
  } = useWebRtcService(
    {
      drawingId: drawing.id,
      userId,
      iceServers,
    },
    {
      onMessage: handleMessage,
      onConnectionClose: () => {
        setIsCollaborating(false);
      },
      onConnectionOpen: () => {
        setIsCollaborating(true);
      },
    },
  );

  const sendUpdate = useCallback(
    ({
      elements,
      appState,
    }: {
      elements: readonly ExcalidrawElement[];
      appState: AppState;
    }) => {
      void sendMessage({
        type: "update",
        userId: userId,
        entityType: "drawing",
        entityId: drawing.id,
        payload: {
          elements,
          appState: appState,
        },
      } as MessageStructure);
    },
    [drawing.id, sendMessage, userId],
  );

  type SendUpdateProps = {
    elements: readonly ExcalidrawElement[];
    appState: AppState;
  };

  const debouncedSendUpdateRef = useRef(
    debounce(({ elements, appState }: SendUpdateProps) => {
      sendUpdate({ elements, appState });
    }, 100),
  );

  /** Saves the scene on screen; says "Saved" only once nothing is newer. */
  const saveScene = useCallback(
    ({ elements, appState }: SendUpdateProps) =>
      openDrawing.sync
        .save({
          appState: JSON.stringify({
            ...appState,
            openDialog: null,
            theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
          } satisfies AppState),
          elements: JSON.stringify(elements as ExcalidrawElement[]),
        })
        .then((outcome) => {
          if (outcome === "saved" && !syncedEditor?.hasLocalEdits())
            markPristine();
        }),
    [isDarkTheme, markPristine, openDrawing, syncedEditor],
  );

  useEffect(() => {
    if (autoSaveEnabled) {
      debouncedSaveRef.current = debounce((scene: SendUpdateProps) => {
        if (holdsSaves()) return;
        saveScene(scene).catch((err: unknown) =>
          console.error("auto save failed: ", err),
        );
      }, 1000);
    } else {
      debouncedSaveRef.current = null;
    }
  }, [autoSaveEnabled, holdsSaves, saveScene]);

  const saveNow = useCallback(() => {
    if (!excalidrawApi) return;
    debouncedSaveRef.current?.cancel();
    saveScene({
      elements: excalidrawApi.getSceneElements(),
      appState: excalidrawApi.getAppState(),
    }).catch((err: unknown) =>
      toast.error("Couldn't save", {
        description: err instanceof Error ? err.message : undefined,
      }),
    );
  }, [excalidrawApi, saveScene]);
  useSaveShortcut(saveNow);
  useFitOnOpen(excalidrawApi);

  const sendUpdateIfNeeded = useCallback(
    ({ elements, appState }: SendUpdateProps) => {
      let changesDetected = false;
      for (const element of elements) {
        const prevElement = prevElementsRef.current.get(element.id);
        if (!prevElement || prevElement.version < element.version) {
          changesDetected = true;
        }
        if (prevElement && prevElement.version > element.version) {
          console.warn("element version mismatch", prevElement, element);
          // elements.push(prevElement);
        }
      }
      if (appState.isResizing) {
        changesDetected = true;
      }
      if (changesDetected) {
        debouncedSendUpdateRef.current({ elements, appState });
      }
      updateElementsRef(new Map(elements.map((e) => [e.id, e])));
    },
    [updateElementsRef],
  );

  const onChange = useCallback(
    (
      elements: readonly ExcalidrawElement[],
      state: AppState,
      _: BinaryFiles,
    ) => {
      if (!needsSave(elements, state)) {
        // Nothing the server lacks, like the scene a reload just showed or
        // an edit undone: a save still waiting would only write back.
        debouncedSaveRef.current?.cancel();
        markPristine();
      } else {
        markDirty();
        if (autoSaveEnabled && !holdsSaves())
          debouncedSaveRef.current?.({ elements, appState: state });
      }
      if (isRemoteUpdate) {
        console.log("remote update detected");
        setIsRemoteUpdate(false);
        return;
      }

      if (isCollaborating) {
        sendUpdateIfNeeded({
          elements,
          appState: state,
        });
      }
    },
    [
      isRemoteUpdate,
      isCollaborating,
      sendUpdateIfNeeded,
      needsSave,
      holdsSaves,
      markDirty,
      markPristine,
      autoSaveEnabled,
    ],
  );

  const options = useMemo(
    () =>
      ({
        initialData: {
          appState: appState
            ? {
                ...appState,
                exportWithDarkMode: false,
                exportBackground: false,
                openMenu: null,
                collaborators:
                  appState.collaborators ?? new Map<SocketId, Collaborator>(),
              }
            : {
                exportWithDarkMode: false,
                exportBackground: false,
                openMenu: null,
              },
          elements: elements ?? [],
        },
        UIOptions: {
          canvasActions: {
            toggleTheme: false,
            // The menu opens and clears only after asking, and Cmd+S saves
            // to Lexidraw rather than to a file.
            loadScene: false,
            clearCanvas: false,
            saveToActiveFile: false,
          },
        },
        onChange: onChange,
      }) as ExcalidrawProps,
    [appState, elements, onChange],
  );

  // trigger live collaboration on mount
  useEffect(() => {
    console.log("canCollaborate", canCollaborate);
    if (!isCollaborating && canCollaborate) {
      initializeConnection()
        .then(() => {
          console.log("connection initialized");
        })
        .catch((err) => {
          console.error("error initializing connection", err);
        });
    }
  }, [isCollaborating, canCollaborate, initializeConnection]);

  // External system: the open drawing's sync, which lets peers' saves pass.
  useEffect(() => {
    openDrawing.sync.setPeersConnected(peersConnected);
  }, [openDrawing, peersConnected]);

  return (
    <div className="absolute inset-0">
      <Excalidraw
        {...options}
        theme={isDarkTheme ? Theme.DARK : Theme.LIGHT}
        excalidrawAPI={(api) => {
          setExcalidrawApi(api);
          onExcalidrawApiReady?.(api);
        }}
      >
        <DrawingBoardMenu
          drawing={drawing}
          excalidrawApi={excalidrawApi}
          onSave={saveNow}
        />
      </Excalidraw>
    </div>
  );
};
export default ExcalidrawWrapper;
