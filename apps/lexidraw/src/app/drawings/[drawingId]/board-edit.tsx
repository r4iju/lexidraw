"use client";

import "@excalidraw/excalidraw/index.css";

import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
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
import ModeToggle from "~/components/theme/dark-mode-toggle";
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
  const { markDirty, markPristine, registerSaveHold } = useUnsavedChanges();
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
  // Leaving must not save over a write the user has not answered.
  useEffect(() => registerSaveHold(holdsSaves), [registerSaveHold, holdsSaves]);

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

  const { sendMessage, initializeConnection } = useWebRtcService(
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

  useEffect(() => {
    if (autoSaveEnabled) {
      debouncedSaveRef.current = debounce(
        ({ elements, appState }: SendUpdateProps) => {
          if (holdsSaves()) {
            markDirty();
            return;
          }
          openDrawing.sync
            .save({
              appState: JSON.stringify({
                ...appState,
                openDialog: null,
                theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
              } satisfies AppState),
              elements: JSON.stringify(elements as ExcalidrawElement[]),
            })
            .then(
              (outcome) => {
                if (outcome === "saved") markPristine();
              },
              (err: unknown) => console.error("auto save failed: ", err),
            );
        },
        1000,
      );
    } else {
      debouncedSaveRef.current = null;
    }
  }, [
    autoSaveEnabled,
    isDarkTheme,
    holdsSaves,
    markDirty,
    markPristine,
    openDrawing,
  ]);

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
      } else if (
        !autoSaveEnabled ||
        holdsSaves() ||
        !debouncedSaveRef.current
      ) {
        markDirty();
      } else {
        debouncedSaveRef.current({ elements, appState: state });
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
                theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
                exportWithDarkMode: false,
                exportBackground: false,
                openMenu: null,
                collaborators:
                  appState.collaborators ?? new Map<SocketId, Collaborator>(),
              }
            : {
                theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
                exportWithDarkMode: false,
                exportBackground: false,
                openMenu: null,
              },
          elements: elements ?? [],
        },
        UIOptions: {
          canvasActions: {
            toggleTheme: false,
          },
        },
        onChange: onChange,
      }) as ExcalidrawProps,
    [appState, elements, isDarkTheme, onChange],
  );

  // switching dark-light mode
  useEffect(() => {
    excalidrawApi?.updateScene({
      appState: { theme: isDarkTheme ? Theme.DARK : Theme.LIGHT },
    });
  }, [excalidrawApi, isDarkTheme]);

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

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Excalidraw
        {...options}
        excalidrawAPI={(api) => {
          setExcalidrawApi(api);
          onExcalidrawApiReady?.(api);
          console.log("excalidraw api set");
        }}
        renderTopRightUI={() => (
          <>
            {/* would be nice to show active users */}
            <ModeToggle className="hidden md:flex" />
          </>
        )}
      >
        <MainMenu>
          <DrawingBoardMenu drawing={drawing} excalidrawApi={excalidrawApi} />
        </MainMenu>
      </Excalidraw>
    </div>
  );
};
export default ExcalidrawWrapper;
