"use client";

import { ThemeProvider } from "~/components/theme/theme-provider";
import ViewBoard from "../../drawings/[drawingId]/board-view-client";
import type { RouterOutputs } from "~/trpc/shared";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

type Props = {
  drawing: RouterOutputs["entities"]["load"];
  theme: "light" | "dark";
  appState?: AppState;
  elements?: ExcalidrawElement[];
};

/**
 * Client component wrapper for rendering drawings in screenshot mode.
 *
 * This component is used specifically for server-side thumbnail generation via headless browser rendering.
 * It wraps the drawing view component with a ThemeProvider that forces the specified theme, ensuring
 * consistent rendering for screenshot capture.
 */
export default function DrawingScreenshotView({
  drawing,
  theme,
  appState,
  elements,
}: Props) {
  const revalidate = () => {
    // No-op for screenshot mode - we don't need to revalidate
  };

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={theme}
      forcedTheme={theme}
      enableSystem={false}
      disableTransitionOnChange
    >
      <div className="w-full h-full" id="screenshot-root">
        <ViewBoard
          revalidate={revalidate}
          drawing={drawing}
          elements={elements}
          appState={appState}
        />
      </div>
    </ThemeProvider>
  );
}
