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
import { api } from "~/trpc/react";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { debounce } from "@packages/lib";
import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import { Theme, type MessageStructure } from "@packages/types";
import { DrawingBoardMenu } from "./dropdown";
import { useUnsavedChanges } from "~/hooks/use-unsaved-changes";
import { useAutoSave } from "~/hooks/use-auto-save";

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
  const excalidrawApi = useRef<ExcalidrawImperativeAPI>(null);
  const { mutate: save } = api.entities.save.useMutation();
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

  const updateElementsRef = useCallback(
    (currentElements: Map<string, ExcalidrawElement>) => {
      prevElementsRef.current = currentElements;
    },
    [],
  );

  const applyUpdate = useCallback(
    ({ elements }: { elements: readonly ExcalidrawElement[] }) => {
      excalidrawApi.current?.updateScene({
        elements,
      });
      setIsRemoteUpdate(true);
      if (excalidrawApi.current) {
        const currentElements = excalidrawApi.current.getSceneElements();
        updateElementsRef(new Map(currentElements.map((e) => [e.id, e])));
      }
    },
    [updateElementsRef],
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

  const debouncedSaveRef = useRef<ReturnType<typeof debounce> | null>(null);

  useEffect(() => {
    if (autoSaveEnabled) {
      debouncedSaveRef.current = debounce(
        ({ elements, appState }: SendUpdateProps) => {
          save(
            {
              id: drawing.id,
              entityType: "drawing",
              appState: JSON.stringify({
                ...appState,
                openDialog: null,
                theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
              } satisfies AppState),
              elements: JSON.stringify(elements as ExcalidrawElement[]),
            },
            {
              onSuccess: () => {
                markPristine();
                console.log("auto save success");
              },
              onError: (err) => console.error("auto save failed: ", err),
            },
          );
        },
        1000,
      );
    } else {
      debouncedSaveRef.current = null;
    }
  }, [autoSaveEnabled, drawing.id, isDarkTheme, markPristine, save]);

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
      if (!autoSaveEnabled) {
        markDirty();
      }
      if (autoSaveEnabled && debouncedSaveRef.current) {
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
      markDirty,
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
    excalidrawApi.current?.updateScene({
      appState: { theme: isDarkTheme ? Theme.DARK : Theme.LIGHT },
    });
  }, [isDarkTheme]);

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
          excalidrawApi.current = api;
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
          <DrawingBoardMenu
            drawing={drawing}
            excalidrawApi={
              excalidrawApi as React.RefObject<ExcalidrawImperativeAPI>
            }
          />
        </MainMenu>
      </Excalidraw>
    </div>
  );
};
export default ExcalidrawWrapper;
