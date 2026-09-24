"use client";

import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SyncedEditor } from "~/lib/open-entity-sync";
import { SceneEdits } from "./scene-edits";

/**
 * Which elements a scene has, at which version. Excalidraw bumps an element's
 * version on every change, so two scenes with the same fingerprint show the
 * same thing; deleted elements are kept around for undo and show nothing.
 */
function fingerprint(elements: readonly ExcalidrawElement[]): string {
  // Called from effects and callbacks: the compiler's `compilationMode: "all"`
  // would otherwise give it a hook's memo cache, which only renders may use.
  "use no memo";
  return elements
    .filter((element) => !element.isDeleted)
    .map((element) => `${element.id}@${element.version}`)
    .join(",");
}

function parse(elements: string): ExcalidrawElement[] {
  "use no memo";
  // Stored elements are canonical: whatever wrote them ran them through
  // `restoreElements`, the browser editor and the drawing procedures alike.
  return JSON.parse(elements) as ExcalidrawElement[];
}

/** What the user can touch a drawing with, from anywhere on the page. */
const TOUCHES = ["pointerdown", "keydown", "paste", "drop"] as const;

/**
 * An Excalidraw scene as `lib/open-entity-sync.ts` sees it, and whether a
 * change to it is anything to save; see `scene-edits.ts`.
 */
export function useSyncedExcalidraw(
  excalidraw: ExcalidrawImperativeAPI | null,
  onReplace?: (elements: readonly ExcalidrawElement[]) => void,
): {
  editor: SyncedEditor | null;
  /** For Excalidraw's `onChange`: the scene holds something to save. */
  needsSave: (elements: readonly ExcalidrawElement[]) => boolean;
} {
  const edits = useRef<SceneEdits | null>(null);

  // External systems: the Excalidraw scene, and the user's input on the page.
  useEffect(() => {
    if (!excalidraw) return;
    const scene = new SceneEdits(fingerprint(excalidraw.getSceneElements()));
    edits.current = scene;
    // Anywhere, not only the canvas: the library, the menus, and the dialogs
    // change the scene too. A touch that edits nothing costs a question at
    // most, and an edit without a touch would be replaced unasked.
    const touch = () => scene.touched();
    const stopChange = excalidraw.onChange((elements) => {
      scene.changed(fingerprint(elements));
    });
    for (const type of TOUCHES) {
      window.addEventListener(type, touch, { capture: true });
    }
    return () => {
      stopChange();
      for (const type of TOUCHES) {
        window.removeEventListener(type, touch, { capture: true });
      }
    };
  }, [excalidraw]);

  const needsSave = useCallback(
    (elements: readonly ExcalidrawElement[]) =>
      edits.current?.changed(fingerprint(elements)) ?? false,
    [],
  );

  const editor = useMemo<SyncedEditor | null>(() => {
    if (!excalidraw) return null;
    const scene = () => fingerprint(excalidraw.getSceneElements());
    return {
      shows: (elements) => scene() === fingerprint(parse(elements)),
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
      saved: (elements) => {
        edits.current?.saved(fingerprint(parse(elements)));
      },
    };
  }, [excalidraw, onReplace]);

  return { editor, needsSave };
}
