import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/** Saves the scene on screen as a .excalidraw file, in the browser. */
export function downloadScene(
  excalidraw: ExcalidrawImperativeAPI,
  name: string,
) {
  const data = JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: window.location.href,
    elements: excalidraw.getSceneElements(),
    appState: excalidraw.getAppState(),
  });
  const url = URL.createObjectURL(
    new Blob([data], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.excalidraw`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
