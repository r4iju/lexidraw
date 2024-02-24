"use client";

import {
  Excalidraw,
  exportToSvg,
  LiveCollaborationTrigger,
  THEME,
} from "@excalidraw/excalidraw";
import {
  type ExcalidrawElement,
  type NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/types/element/types";
import {
  type UIAppState,
  type ExcalidrawImperativeAPI,
  type ExcalidrawProps,
  type BinaryFiles,
} from "@excalidraw/excalidraw/types/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";
import type { RouterOutputs, RouterInputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import { CommitIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import { debounce } from "~/lib/debounce";
// import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import { useFirestoreService } from "~/hooks/communication-service/use-firestore";

type MessageStructure = {
  type: "update";
  payload: {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };
};

type Props = {
  drawing: RouterOutputs["drawings"]["load"];
  appState?: UIAppState;
  elements?: NonDeletedExcalidrawElement[];
};

function convertElementToAPIFormat(
  element: NonDeletedExcalidrawElement,
): RouterInputs["elements"]["create"]["element"] {
  const { id, type, x, y, width, height, ...properties } = element;
  return {
    id,
    type,
    x,
    y,
    width,
    height,
    properties: JSON.stringify(properties),
  };
}

const ExcalidrawWrapper: React.FC<Props> = ({
  drawing,
  appState,
  elements,
}) => {
  // hooks
  const isDarkTheme = useIsDarkTheme();
  const userId = useUserIdOrGuestId();
  const { toast } = useToast();
  // excalidraw api
  const excalidrawApi = useRef<ExcalidrawImperativeAPI | null>(null);
  // server state
  const { mutate: save, isLoading: isSaving } = api.drawings.save.useMutation();
  // const { mutate: updateDrawing } = api.drawings.update.useMutation();
  // const { mutate: createElement } = api.elements.create.useMutation();
  // const { mutate: upsertElement } = api.elements.upsert.useMutation();
  // const { mutate: deleteElement } = api.elements.delete.useMutation();
  // const { mutate: saveAppState } = api.appState.upsert.useMutation();
  // const { mutate: setElementsOrder } = api.drawings.setElementsOrder.useMutation();
  // local state
  const [isCollaborating, setIsCollaborating] = useState(false);
  const prevElementsRef = useRef<Map<string, ExcalidrawElement>>(
    new Map(elements?.map((e) => [e.id, e])),
  );
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  // thumbnails
  const { mutate: saveSvg } = api.snapshot.create.useMutation();

  const applyUpdate = useCallback(({ elements }: ApplyUpdateProps) => {
    excalidrawApi.current?.updateScene({
      elements,
      // appState: {
      //   ...appState,
      //   collaborators: new Map(Object.entries(appState.collaborators)),
      // },
    });
  }, []);

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
  const { sendMessage, initializeConnection, closeConnection } =
    // useWebRtcService(
    useFirestoreService(
      {
        drawingId: drawing.id,
        userId,
      },
      {
        onMessage: handleMessage,
      },
    );

  type ApplyUpdateProps = {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };

  const sendUpdate = useCallback(
    ({
      elements,
      appState,
    }: {
      elements: ExcalidrawElement[];
      appState: UIAppState;
    }) => {
      sendMessage({
        type: "update",
        payload: {
          elements,
          appState,
        },
      } satisfies MessageStructure);
    },
    [sendMessage],
  );

  type SendUpdateProps = {
    elements: ExcalidrawElement[];
    appState: UIAppState;
  };

  const sendPositionUpdates = useCallback(
    debounce(() => {
      const currentElements = excalidrawApi.current?.getSceneElements() ?? [];
      let isPositionChanged = false;
      currentElements.forEach((element) => {
        const prevPosition = prevPositionsRef.current.get(element.id);
        if (
          !prevPosition ||
          prevPosition.x !== element.x ||
          prevPosition.y !== element.y
        ) {
          isPositionChanged = true;
          prevPositionsRef.current.set(element.id, {
            x: element.x,
            y: element.y,
          });
        }
      });

      const appState = excalidrawApi.current?.getAppState();

      if (isPositionChanged && appState) {
        sendUpdate({ elements: Array.from(currentElements), appState });
      }
    }, 150),
    [],
  );

  const updateElementsRef = useCallback(
    (currentElements: Map<string, ExcalidrawElement>) => {
      prevElementsRef.current = currentElements;
    },
    [],
  );

  const sendUpdateIfNeeded = useCallback(
    ({ elements, appState }: SendUpdateProps) => {
      let changesDetected = false;
      const elementsToUpdate: ExcalidrawElement[] = [];
      const newElementsMap = new Map<string, ExcalidrawElement>();

      elements.forEach((element) => {
        const prevElement = prevElementsRef.current.get(element.id);
        if (!prevElement || prevElement.version !== element.version) {
          // console.log(
          //   `Change detected for element ${element.id}: Version ${prevElement?.version} -> ${element.version}, Position ${prevElement?.x},${prevElement?.y} -> ${element.x},${element.y}`,
          // );
          changesDetected = true;
          elementsToUpdate.push(element);
        }
        newElementsMap.set(element.id, element);
      });

      if (changesDetected) {
        console.log("Sending updates for changed elements");
        sendUpdate({ elements, appState });
      }
      updateElementsRef(newElementsMap);
    },
    [sendUpdate, updateElementsRef],
  );

  const saveToBackend = async () => {
    if (!excalidrawApi.current) return;
    const elements = excalidrawApi.current.getSceneElements();
    const appState: UIAppState = excalidrawApi.current.getAppState();
    await exportDrawingAsSvg({ elements: elements, appState });
    save(
      {
        id: drawing.id,
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
          theme: isDarkTheme ? THEME.DARK : THEME.LIGHT,
        } satisfies UIAppState),
        elements: elements.map(convertElementToAPIFormat),
      },
      {
        onSuccess: () => {
          toast({
            title: "Saved!",
          });
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
    if (drawing.publicAccess === "PRIVATE" || drawing.sharedWith.length === 0) {
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
      initializeConnection();
    }
    setIsCollaborating((prev) => !prev);
  };

  type ExportAsSvgProps = {
    elements: readonly ExcalidrawElement[];
    appState: UIAppState;
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
          drawingId: drawing.id,
          svg: svgString,
          theme: theme,
        });
      }),
    );
  };

  const onChange = (
    elements: readonly ExcalidrawElement[],
    state: UIAppState,
    _: BinaryFiles,
  ) => {
    const nonDeletedElements = elements.filter(
      (el) => !el.isDeleted,
    ) as NonDeletedExcalidrawElement[];
    if (isCollaborating) {
      sendUpdateIfNeeded({ elements: nonDeletedElements, appState: state });
      sendPositionUpdates();
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
            collaborators: new Map(Object.entries(appState.collaborators)),
          } satisfies UIAppState)
        : ({
            theme: isDarkTheme ? THEME.DARK : THEME.LIGHT,
            exportWithDarkMode: false,
            exportBackground: false,
          } satisfies Partial<UIAppState>),
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
            />
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
