"use client";

import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useRef } from "react";
import type { SyncedEditor } from "~/lib/open-entity-sync";

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

/**
 * An Excalidraw scene as `lib/open-entity-sync.ts` sees it.
 *
 * Excalidraw has no notion of which changes the user made: loading a scene
 * and re-measuring its text once the fonts arrive bump versions too. So the
 * baseline follows the scene until the user first touches it — a pointer or a
 * key — and only a change after that is an edit. Touching without changing,
 * like panning, leaves the fingerprint where it was.
 */
export function useSyncedExcalidraw(
  excalidraw: ExcalidrawImperativeAPI | null,
  onReplace?: (elements: readonly ExcalidrawElement[]) => void,
): SyncedEditor | null {
  const baseline = useRef("");
  const touched = useRef(false);

  // External systems: the Excalidraw scene, and the user's input on the page.
  useEffect(() => {
    if (!excalidraw) return;
    baseline.current = fingerprint(excalidraw.getSceneElements());
    touched.current = false;
    const touch = () => {
      touched.current = true;
    };
    const stopChange = excalidraw.onChange((elements) => {
      if (!touched.current) baseline.current = fingerprint(elements);
    });
    const stopPointer = excalidraw.onPointerDown(touch);
    window.addEventListener("keydown", touch, { capture: true });
    window.addEventListener("paste", touch, { capture: true });
    window.addEventListener("drop", touch, { capture: true });
    return () => {
      stopChange();
      stopPointer();
      window.removeEventListener("keydown", touch, { capture: true });
      window.removeEventListener("paste", touch, { capture: true });
      window.removeEventListener("drop", touch, { capture: true });
    };
  }, [excalidraw]);

  return useMemo<SyncedEditor | null>(() => {
    if (!excalidraw) return null;
    const scene = () => fingerprint(excalidraw.getSceneElements());
    return {
      shows: (elements) => scene() === fingerprint(parse(elements)),
      hasLocalEdits: () => scene() !== baseline.current,
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
        baseline.current = scene();
        touched.current = false;
        onReplace?.(excalidraw.getSceneElements());
      },
      saved: (elements) => {
        baseline.current = fingerprint(parse(elements));
      },
    };
  }, [excalidraw, onReplace]);
}
