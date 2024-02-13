"use client";

import deepEqual from "fast-deep-equal/es6/react";
import {
  Excalidraw,
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

type ElementChanges = {
  added: ExcalidrawElement[];
  updated: ExcalidrawElement[];
  deleted: string[];
};

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
  const { mutate: save } = api.drawings.save.useMutation();
  // please use these to create, update and delete elements
  const { mutate: createElement } = api.elements.create.useMutation();
  const { mutate: updateElement } = api.elements.update.useMutation();
  const { mutate: deleteElement } = api.elements.delete.useMutation();
  const { mutate: saveAppState } = api.appState.upsert.useMutation();
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

  const saveToBackend = ({
    exportedElements,
    appState,
  }: {
    exportedElements: NonDeletedExcalidrawElement[];
    appState: UIAppState;
  }) => {
    console.log({ exportedElements, appState });
    save(
      {
        id: drawingId,
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
        } satisfies UIAppState),
        elements: exportedElements.map(convertElementToAPIFormat),
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
        updateElement({
          drawingId: drawingId,
          element: convertElementToAPIFormat(element),
        });
      });

      deleted.map((id) => {
        deleteElement({
          id: id,
        });
      });

      updateElementsRef(elements); // Update the reference after processing changes
    }, 500),
    [],
  );

  // implement this please
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAppStateChange = useCallback(
    debounce((newAppState: UIAppState) => {
      saveAppState({
        drawingId: drawingId,
        appState: JSON.stringify(newAppState),
      });
    }, 2000),
    [],
  );

  const options = {
    excalidrawAPI: (api) => setExcalidrawAPI(api),
    initialData: {
      appState: appState
        ? ({
            ...appState,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            collaborators: new Map(Object.entries(appState.collaborators)),
          } satisfies UIAppState)
        : ({
            theme: isDarkTheme ? THEME.DARK : THEME.LIGHT,
            viewBackgroundColor: "#ffffff",
            exportWithDarkMode: true, // Indicates whether to export with dark mode
            exportBackground: true, // Indicates whether background should be exported
            exportEmbedScene: true, // Indicates whether scene data should be embedded in svg/png. This will increase the image size.
            // collaborators: new Map(),
          } satisfies Partial<UIAppState>),
      elements: elements ?? [],
    },
    UIOptions: {
      canvasActions: {
        export: {
          onExportToBackend(exportedElements, appState) {
            saveToBackend({
              exportedElements: [...exportedElements],
              appState,
            });
          },
        },
        toggleTheme: false,
      },
    },
    onChange: (elements, state, files) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDarkTheme]);

  return (
    <div style={{ width: "100vw", height: "90vh" }}>
      <Excalidraw
        {...options}
        renderTopRightUI={() => (
          <LiveCollaborationTrigger
            isCollaborating={isCollaborating}
            onSelect={() => {
              console.log("You clicked on collab button");
              setIsCollaborating(true);
            }}
          />
        )}
      ></Excalidraw>
    </div>
  );
};
export default ExcalidrawWrapper;
