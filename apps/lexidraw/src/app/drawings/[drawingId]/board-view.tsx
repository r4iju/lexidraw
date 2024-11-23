"use client";

import "@dwelle/excalidraw/dist/dev/index.css";
import { Excalidraw, THEME } from "@dwelle/excalidraw";
import { type NonDeletedExcalidrawElement } from "@dwelle/excalidraw/dist/excalidraw/element/types";
import {
  type UIAppState,
  type ExcalidrawImperativeAPI,
  type ExcalidrawProps,
  type Collaborator,
} from "@dwelle/excalidraw/dist/excalidraw/types";
import { useEffect, useState } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { type RouterOutputs } from "~/trpc/shared";

type Props = {
  revalidate: () => void;
  drawing: RouterOutputs["entities"]["load"];
  appState?: UIAppState;
  elements?: NonDeletedExcalidrawElement[];
};

const ExcalidrawViewWrapper: React.FC<Props> = ({
  appState,
  elements,
  revalidate,
}) => {
  const [excalidrawApi, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const isDarkTheme = useIsDarkTheme();

  const options = {
    excalidrawAPI: (api) => setExcalidrawAPI(api),
    viewModeEnabled: true,
    initialData: {
      appState: appState
        ? ({
            ...appState,
            collaborators: appState.collaborators
              ? new Map(Object.entries(appState.collaborators))
              : new Map<string, Collaborator>(),
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
        toggleTheme: false,
      },
    },
    // isCollaborating: true,
  } satisfies ExcalidrawProps;

  useEffect(() => {
    excalidrawApi?.updateScene({
      appState: { theme: isDarkTheme ? THEME.DARK : THEME.LIGHT },
    });
  }, [excalidrawApi, isDarkTheme]);

  useEffect(() => {
    return () => {
      revalidate();
    };
  }, [revalidate]);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Excalidraw {...options}></Excalidraw>
    </div>
  );
};
export default ExcalidrawViewWrapper;
