"use client";

import "@excalidraw/excalidraw/index.css";

import { Excalidraw, THEME } from "@excalidraw/excalidraw";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  Collaborator,
  UIAppState,
  ExcalidrawImperativeAPI,
  ExcalidrawProps,
  SocketId,
} from "@excalidraw/excalidraw/types";
import { useEffect, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { useOpenEntity, useOpenEntitySync } from "~/hooks/use-open-entity-sync";
import { useSyncedExcalidraw } from "./use-synced-excalidraw";
import { useFitOnOpen } from "./use-fit-on-open";
import type { RouterOutputs } from "~/trpc/shared";

type Props = {
  revalidate: () => void;
  drawing: RouterOutputs["entities"]["load"];
  appState?: UIAppState;
  elements?: NonDeletedExcalidrawElement[];
};

const ExcalidrawViewWrapper: React.FC<Props> = ({
  drawing,
  appState,
  elements,
  revalidate,
}) => {
  const [excalidrawApi, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const synced = useSyncedExcalidraw(excalidrawApi);
  const openDrawing = useOpenEntity(drawing, "drawing");
  useOpenEntitySync(openDrawing, { editor: synced.editor });
  const isDarkTheme = useIsDarkTheme();

  const options = {
    excalidrawAPI: (api) => setExcalidrawAPI(api),
    viewModeEnabled: true,
    initialData: {
      appState: appState
        ? ({
            ...appState,
            openMenu: null,
            collaborators:
              appState.collaborators ?? new Map<SocketId, Collaborator>(),
          } satisfies UIAppState)
        : ({
            exportWithDarkMode: true, // Indicates whether to export with dark mode
            exportBackground: true, // Indicates whether background should be exported
            exportEmbedScene: true, // Indicates whether scene data should be embedded in svg/png. This will increase the image size.
            openMenu: null,
            // collaborators: new Map(),
          } satisfies Partial<UIAppState>),
      elements: elements ?? [],
    },
    UIOptions: {
      canvasActions: {
        toggleTheme: false,
      },
    },
    // Keeps the scene the server stores in step with what shows.
    onChange: (elements, state) => {
      synced.needsSave(elements, state);
    },
    // isCollaborating: true,
  } satisfies ExcalidrawProps;

  useFitOnOpen(excalidrawApi);

  useEffect(() => {
    return () => {
      revalidate();
    };
  }, [revalidate]);

  return (
    <div className="absolute inset-0">
      <Excalidraw {...options} theme={isDarkTheme ? THEME.DARK : THEME.LIGHT} />
    </div>
  );
};
export default ExcalidrawViewWrapper;
