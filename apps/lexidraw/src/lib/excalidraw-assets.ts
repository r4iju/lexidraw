/**
 * Where the app serves Excalidraw's fonts, and the worker it cuts them down
 * to the characters a drawing uses; `scripts/excalidraw-assets.ts` fills it.
 */
export const EXCALIDRAW_ASSETS = "/excalidraw-assets/";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}
