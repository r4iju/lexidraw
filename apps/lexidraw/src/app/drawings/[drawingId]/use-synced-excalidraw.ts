"use client";

import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SyncedEditor } from "~/lib/open-entity-sync";
import { SceneEdits, sceneKey } from "./scene-edits";

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

/** What the user can touch a drawing with, from anywhere on the page. */
const TOUCHES = ["keydown", "paste", "drop"] as const;
/** What ends a press; a blur covers a release the page never saw. */
const RELEASES = ["pointerup", "pointercancel", "blur"] as const;

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
    // Anywhere, not only the canvas: the library, the menus, and the dialogs
    // change the scene too. A touch that edits nothing costs a question at
    // most, and an edit without a touch would be replaced unasked.
    const touch = () => scene.touched();
    const press = () => scene.pressed();
    const release = () => scene.released();
    window.addEventListener("pointerdown", press, { capture: true });
    for (const type of TOUCHES) {
      window.addEventListener(type, touch, { capture: true });
    }
    for (const type of RELEASES) {
      window.addEventListener(type, release, { capture: true });
    }
    return () => {
      if (edits.current === scene) edits.current = null;
      window.removeEventListener("pointerdown", press, { capture: true });
      for (const type of TOUCHES) {
        window.removeEventListener(type, touch, { capture: true });
      }
      for (const type of RELEASES) {
        window.removeEventListener(type, release, { capture: true });
      }
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
