"use client";

import { CaptureUpdateAction, getCommonBounds } from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";
import { useEffect } from "react";
import { fitOnOpen } from "./fit-on-open";

/** Brings a drawing's content into view once, as it opens; see `fitOnOpen`. */
export function useFitOnOpen(excalidraw: ExcalidrawImperativeAPI | null) {
  // External system: the Excalidraw view, measured once it has laid out.
  useEffect(() => {
    if (!excalidraw) return;
    let frame = 0;
    const fit = () => {
      const state = excalidraw.getAppState();
      if (state.isLoading || !state.width || !state.height) {
        frame = requestAnimationFrame(fit);
        return;
      }
      const elements = excalidraw.getSceneElements();
      const next = fitOnOpen(
        elements.length > 0 ? getCommonBounds(elements) : null,
        {
          width: state.width,
          height: state.height,
          scrollX: state.scrollX,
          scrollY: state.scrollY,
          zoom: state.zoom.value,
        },
      );
      if (!next) return;
      excalidraw.updateScene({
        appState: {
          scrollX: next.scrollX,
          scrollY: next.scrollY,
          zoom: { value: next.zoom as NormalizedZoomValue },
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };
    frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [excalidraw]);
}
