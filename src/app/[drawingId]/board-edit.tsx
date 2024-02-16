"use client";

import deepEqual from "fast-deep-equal/es6/react";
import {
  Excalidraw,
  exportToSvg,
  LiveCollaborationTrigger,
  THEME,
  // exportToCanvas,
  // restore,
  // restoreAppState,
} from "@excalidraw/excalidraw";
import {
  type ExcalidrawElement,
  type NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/types/element/types";
import {
  type UIAppState,
  type ExcalidrawImperativeAPI,
  type ExcalidrawProps,
} from "@excalidraw/excalidraw/types/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useToast } from "~/components/ui/use-toast";
import { api } from "~/trpc/react";
import { type RouterInputs } from "~/trpc/shared";
import { Button } from "~/components/ui/button";
import { CommitIcon, ReloadIcon } from "@radix-ui/react-icons";
import { PublicAccess } from "@prisma/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debounce<F extends (...args: any[]) => void>(
  fn: F,
  delay: number,
): (this: ThisParameterType<F>, ...args: Parameters<F>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return function (...args: Parameters<F>) {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delay);
  };
}

type Props = {
  drawingId: string;
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
  drawingId,
  appState,
  elements,
}) => {
  const [excalidrawApi, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [isCollaborating, setIsCollaborating] = useState(false);
  const isDarkTheme = useIsDarkTheme();
  const { toast } = useToast();
  const { mutate: save, isLoading: isSaving } = api.drawings.save.useMutation();
  // please use these to create, update and delete elements
  const { mutate: updateDrawing } = api.drawings.update.useMutation();
  const { mutate: createElement } = api.elements.create.useMutation();
  const { mutate: upsertElement } = api.elements.upsert.useMutation();
  const { mutate: deleteElement } = api.elements.delete.useMutation();
  const { mutate: saveAppState } = api.appState.upsert.useMutation();
  const { mutate: saveSvg } = api.snapshot.create.useMutation();
  const { mutate: setElementsOrder } =
    api.drawings.setElementsOrder.useMutation();
  const prevElementsRef = useRef<Map<string, ExcalidrawElement>>(
    new Map(elements?.map((e) => [e.id, e])),
  );
  const updateElementsRef = useCallback(
    (currentElements: readonly ExcalidrawElement[]) => {
      const newMap = new Map();
      currentElements.forEach((element) => {
        newMap.set(element.id, element);
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      prevElementsRef.current = newMap;
    },
    [],
  );

  const saveToBackend = async () => {
    if (!excalidrawApi) return;
    const elements = excalidrawApi.getSceneElements();
    const appState: UIAppState = excalidrawApi?.getAppState();
    await exportDrawingAsSvg({ elements: elements, appState });
    save(
      {
        id: drawingId,
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleElementsChange = useCallback(
    debounce((elements: readonly ExcalidrawElement[]) => {
      const prevElementsMap = prevElementsRef.current;
      const added: ExcalidrawElement[] = [];
      const updated: ExcalidrawElement[] = [];
      const deleted: string[] = [];

      elements.forEach((element) => {
        const prevElement = prevElementsMap.get(element.id);
        if (!prevElement) {
          added.push(element);
        } else if (!deepEqual(element, prevElement)) {
          updated.push(element);
        }
      });

      prevElementsMap.forEach((_, id) => {
        if (!elements.find((el) => el.id === id)) {
          deleted.push(id);
        }
      });

      added.map((element) => {
        createElement({
          drawingId: drawingId,
          element: convertElementToAPIFormat(element),
        });
      });

      updated.map((element) => {
        upsertElement({
          drawingId: drawingId,
          element: convertElementToAPIFormat(element),
        });
      });

      deleted.map((id) => {
        deleteElement({
          id: id,
        });
      });

      if (added.length || updated.length || deleted.length) {
        setElementsOrder({
          drawingId: drawingId,
          elementsOrder: elements.map((el) => el.id),
        });
      }

      updateElementsRef(elements); // Update the reference after processing changes
    }, 500),
    [],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAppStateChange = useCallback(
    debounce((newAppState: UIAppState) => {
      saveAppState({
        drawingId: drawingId,
        appState: JSON.stringify(newAppState),
      });
    }, 10000),
    [],
  );

  const handleToggleLiveCollaboration = async () => {
    const wasCollaborating = isCollaborating.valueOf();
    const newAccessLevel = wasCollaborating
      ? PublicAccess.EDIT
      : PublicAccess.READ;
    updateDrawing(
      { id: drawingId, publicAccess: newAccessLevel },
      {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSuccess: async () => {
          await navigator.clipboard.writeText(
            wasCollaborating ? "" : window.location.origin + "/" + drawingId,
          );
          toast(
            wasCollaborating
              ? {
                  title: "Live collaboration disabled!",
                  variant: "destructive",
                }
              : {
                  title: "Live collaboration enabled!",
                  description: "Link copied to clipboard",
                  variant: "default",
                },
          );
          setIsCollaborating(!wasCollaborating);
        },
        onError: (error) => {
          toast({
            title: "Something went wrong!",
            description: error.message,
            variant: "destructive",
          });
          return;
        },
      },
    );
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
          drawingId: drawingId,
          svg: svgString,
          theme: theme,
        });
      }),
    );

    // for (const theme of [THEME.DARK, THEME.LIGHT]) {
    //   const svg = await exportToSvg({
    //     elements,
    //     appState: {
    //       ...appState,
    //       theme: theme,
    //       exportWithDarkMode: theme === THEME.DARK ? true : false,
    //     },
    //     files: null,
    //     exportPadding: 10,
    //     renderEmbeddables: true,
    //     exportingFrame: null,
    //   });

    //   // convert it to string
    //   const svgString = new XMLSerializer().serializeToString(svg);
    //   saveSvg({
    //     drawingId: drawingId,
    //     svg: svgString,
    //     theme: theme,
    //   });
    // }
  };

  const options = {
    excalidrawAPI: (api) => setExcalidrawAPI(api),
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
    onChange: (elements, state, _) => {
      const nonDeletedElements = elements.filter(
        (el) => !el.isDeleted,
      ) as NonDeletedExcalidrawElement[];
      handleElementsChange(nonDeletedElements);
      handleAppStateChange(state);
    },
    // isCollaborating: true,
  } satisfies ExcalidrawProps;

  useEffect(() => {
    excalidrawApi?.updateScene({
      appState: { theme: isDarkTheme ? THEME.DARK : THEME.LIGHT },
    });
  }, [isDarkTheme, excalidrawApi]);

  return (
    <div style={{ width: "100vw", height: "90vh" }}>
      <Excalidraw
        {...options}
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
          </>
        )}
      />
    </div>
  );
};
export default ExcalidrawWrapper;
