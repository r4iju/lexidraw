/// <reference lib="dom" />
import type { ImageFile } from "./scenes.js";

/** Draws each file as the PNG data URL a browser encodes it to. */
export function drawImageFiles(
  files: Record<string, ImageFile>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([id, { width, height, colors }]) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      colors.forEach((color, index) => {
        if (!context) return;
        context.fillStyle = color;
        context.fillRect(
          (index % 2) * (width / 2),
          Math.floor(index / 2) * (height / 2),
          width / 2,
          height / 2,
        );
      });
      return [id, canvas.toDataURL("image/png")];
    }),
  );
}
