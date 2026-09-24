"use client";

import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SyncedEditor } from "~/lib/open-entity-sync";
import { SceneEdits, sceneKey, watchPageInput } from "./scene-edits";

function parse(elements: string): ExcalidrawElement[] {
  // Stored elements are canonical: whatever wrote them ran them through
  // `restoreElements`, the browser editor and the drawing procedures alike.
  return JSON.parse(elements) as ExcalidrawElement[];
}

/** The app state a save sent, if it is readable. */
function sentAppState(appState: string | undefined): AppStateKey {
  if (!appState) return undefined;
  try {
    const parsed = JSON.parse(appState) as Partial<AppState> | null;
    return parsed ?? undefined;
  } catch {
    return undefined;
  }
}

type AppStateKey = Parameters<typeof sceneKey>[1];

/**
 * An Excalidraw scene as `lib/open-entity-sync.ts` sees it, and whether a
 * change to it is anything to save; see `scene-edits.ts`.
 */
export function useSyncedExcalidraw(
  excalidraw: ExcalidrawImperativeAPI | null,
  onReplace?: (elements: readonly ExcalidrawElement[]) => void,
): {
  editor: SyncedEditor | null;
  /**
   * Excalidraw's `onChange`, which every editor must forward: answers whether
   * the scene holds something the server does not store.
   */
  needsSave: (
    elements: readonly ExcalidrawElement[],
    appState: AppStateKey,
  ) => boolean;
} {
  const edits = useRef<SceneEdits | null>(null);

  // External systems: the Excalidraw scene, and the user's input on the page.
  useEffect(() => {
    if (!excalidraw) return;
    const scene = new SceneEdits(
      sceneKey(excalidraw.getSceneElements(), excalidraw.getAppState()),
    );
    edits.current = scene;
    const stopWatching = watchPageInput(window, scene);
    return () => {
      if (edits.current === scene) edits.current = null;
      stopWatching();
    };
  }, [excalidraw]);

  const needsSave = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppStateKey) =>
      edits.current?.changed(sceneKey(elements, appState)) ?? false,
    [],
  );

  const editor = useMemo<SyncedEditor | null>(() => {
    if (!excalidraw) return null;
    const scene = () =>
      sceneKey(excalidraw.getSceneElements(), excalidraw.getAppState());
    return {
      // A stored revision carries elements only, and so does this answer.
      shows: (elements) =>
        sceneKey(excalidraw.getSceneElements()) === sceneKey(parse(elements)),
      hasLocalEdits: () => edits.current?.hasLocalEdits(scene()) ?? true,
      replace: ({ elements }) => {
        const next = restoreElements(parse(elements), null, {
          repairBindings: true,
        });
        excalidraw.updateScene({
          elements: next,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        // Undo must not bring back what the reload replaced.
        excalidraw.history.clear();
        edits.current?.replaced(scene());
        onReplace?.(excalidraw.getSceneElements());
      },
      saved: (elements, appState) => {
        edits.current?.saved(sceneKey(parse(elements), sentAppState(appState)));
      },
    };
  }, [excalidraw, onReplace]);

  return { editor, needsSave };
}
