"use client";

import {
  Excalidraw,
  exportToSvg,
  LiveCollaborationTrigger,
  THEME,
} from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/types/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  BinaryFiles,
} from "@excalidraw/excalidraw/types/types";
import type { RouterOutputs } from "~/trpc/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { CommitIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { debounce } from "@packages/lib";
import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import { type MessageStructure } from "@packages/types";

type Props = {
  drawing: RouterOutputs["entities"]["load"];
  appState?: AppState;
  elements?: NonDeletedExcalidrawElement[];
  iceServers: RTCIceServer[];
};

const ExcalidrawWrapper: React.FC<Props> = ({
  drawing,
  appState,
  elements,
  iceServers,
}) => {
  // hooks
  const isDarkTheme = useIsDarkTheme();
  const userId = useUserIdOrGuestId();
  const { toast } = useToast();

  // excalidraw api
  const excalidrawApi = useRef<ExcalidrawImperativeAPI | null>(null);
  // server state
  const { mutate: save, isLoading: isSaving } = api.entities.save.useMutation();
  // local state
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const prevElementsRef = useRef(
    new Map<string, ExcalidrawElement>(elements?.map((e) => [e.id, e])),
  );
  // thumbnails
  const { mutate: saveSvg } = api.snapshot.create.useMutation();

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
        // appState: {
        //   ...appState,
        //   collaborators: new Map(Object.entries(appState.collaborators)),
        // },
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
          applyUpdate(message.payload);
          break;
      }
    },
    [applyUpdate],
  );
  const { sendMessage, initializeConnection, closeConnection, peers } =
    useWebRtcService(
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
        drawingId: drawing.id,
        payload: {
          elements,
          appState,
        },
      } satisfies MessageStructure);
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
    }, 30),
  );

  const debouncedSaveRef = useRef(
    debounce(({ elements, appState }: SendUpdateProps) => {
      save(
        {
          id: drawing.id,
          entityType: "drawing",
          appState: JSON.stringify({
            ...appState,
            openDialog: null,
          } satisfies AppState),
          elements: JSON.stringify(elements as ExcalidrawElement[]), // readonly... hmm
        },
        {
          onSuccess: () => console.log("auto save success"),
          onError: (err) => console.error("auto save failed: ", err),
        },
      );
    }, 10000),
  );

  const sendUpdateIfNeeded = useCallback(
    ({ elements, appState }: SendUpdateProps) => {
      let changesDetected = false;
      elements.forEach((element) => {
        const prevElement = prevElementsRef.current.get(element.id);
        if (!prevElement || prevElement.version < element.version) {
          changesDetected = true;
        }
        if (prevElement && prevElement.version > element.version) {
          console.warn("element version mismatch", prevElement, element);
          // elements.push(prevElement);
        }
      });
      if (appState.isResizing || appState.draggingElement) {
        changesDetected = true;
      }
      if (changesDetected) {
        debouncedSendUpdateRef.current({ elements, appState });
      }
      updateElementsRef(new Map(elements.map((e) => [e.id, e])));
    },
    [updateElementsRef],
  );

  const saveToBackend = async () => {
    if (!excalidrawApi.current) return;
    const elements =
      excalidrawApi.current.getSceneElements() as ExcalidrawElement[];
    const appState: AppState = excalidrawApi.current.getAppState();
    save(
      {
        id: drawing.id,
        entityType: "drawing",
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
          theme: isDarkTheme ? THEME.DARK : THEME.LIGHT,
        } satisfies AppState),
        elements: JSON.stringify(elements),
      },
      {
        onSuccess: async () => {
          toast({
            title: "Saved!",
          });
          await exportDrawingAsSvg({ elements: elements, appState });
        },
        onError: (err) => {
          toast({
            title: "Something went wrong!",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleToggleLiveCollaboration = async () => {
    if (drawing.publicAccess === "PRIVATE" && drawing.sharedWith.length === 0) {
      toast({
        title: "This drawing is private",
        description: "You can't collaborate on private drawings",
        variant: "destructive",
      });
      return;
    }
    if (isCollaborating) {
      closeConnection();
    } else {
      await initializeConnection();
    }
  };

  type ExportAsSvgProps = {
    elements: readonly ExcalidrawElement[];
    appState: AppState;
  };

  const exportDrawingAsSvg = async ({
    elements,
    appState,
  }: ExportAsSvgProps) => {
    await Promise.all(
      [THEME.DARK, THEME.LIGHT].map(async (theme) => {
        const svg = await exportToSvg({
          elements,
          appState: {
            ...appState,
            theme: theme,
            exportWithDarkMode: theme === THEME.DARK ? true : false,
          },
          files: null,
          exportPadding: 10,
          renderEmbeddables: true,
          exportingFrame: null,
        });

        // convert it to string
        const svgString = new XMLSerializer().serializeToString(svg);
        saveSvg({
          entityId: drawing.id,
          svg: svgString,
          theme: theme,
        });
      }),
    );
  };

  const onChange = (
    elements: readonly ExcalidrawElement[],
    state: AppState,
    _: BinaryFiles,
  ) => {
    debouncedSaveRef.current({ elements, appState: state });
    if (isRemoteUpdate) {
      console.log("remote update detected");
      setIsRemoteUpdate(false);
      return;
    }

    if (isCollaborating) {
      sendUpdateIfNeeded({
        elements: elements,
        appState: state,
      });
    }
  };

  const options = {
    // excalidrawAPI: (api) => setExcalidrawAPI(api),
    initialData: {
      appState: appState
        ? ({
            ...appState,
            theme: isDarkTheme ? THEME.DARK : THEME.LIGHT, // Ensure the theme matches the site's theme
            exportWithDarkMode: false,
            exportBackground: false,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            collaborators: appState.collaborators
              ? new Map(Object.entries(appState.collaborators))
              : new Map(),
          } satisfies AppState)
        : ({
            theme: isDarkTheme ? THEME.DARK : THEME.LIGHT,
            exportWithDarkMode: false,
            exportBackground: false,
          } satisfies Partial<AppState>),
      elements: elements ?? [],
    },
    UIOptions: {
      canvasActions: {
        // export: {
        //   onExportToBackend(exportedElements, appState) {
        //     void saveToBackend({
        //       exportedElements: [...exportedElements],
        //       appState,
        //     });
        //   },
        // },
        toggleTheme: false,
      },
    },
    onChange: onChange,
    // isCollaborating: true,
  } satisfies ExcalidrawProps;

  // switching dark-light mode
  useEffect(() => {
    excalidrawApi.current?.updateScene({
      appState: { theme: isDarkTheme ? THEME.DARK : THEME.LIGHT },
    });
  }, [isDarkTheme]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      closeConnection();
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Excalidraw
        {...options}
        excalidrawAPI={(api) => {
          excalidrawApi.current = api;
          console.log("excalidraw api set");
        }}
        renderTopRightUI={() => (
          <>
            <LiveCollaborationTrigger
              isCollaborating={isCollaborating}
              onSelect={handleToggleLiveCollaboration}
            >
              <Badge variant="default">{peers.length + 1}</Badge>
            </LiveCollaborationTrigger>
            <Button onClick={saveToBackend} disabled={isSaving}>
              {!isSaving && <CommitIcon className=" h-4 w-4 " />}
              {isSaving && <ReloadIcon className=" h-4 w-4 animate-spin" />}
            </Button>
            <ModeToggle />
          </>
        )}
      />
    </div>
  );
};
export default ExcalidrawWrapper;
