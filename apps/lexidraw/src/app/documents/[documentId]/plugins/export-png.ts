"use client";

import html2canvas from "html2canvas-pro";

type Props = {
  setTheme: () => void;
  restoreTheme: () => void;
};

export async function exportPng({
  setTheme,
  restoreTheme,
}: Props): Promise<Blob> {
  const element = (document.querySelector('[id^="lexical-content-"]') ||
    document.querySelector("#lexical-content")) as HTMLElement;
  if (!element) {
    throw new Error("Lexical content element not found");
  }

  // Start performance tracing
  performance.mark("start");

  setTheme();

  // Capture element as PNG using html2canvas
  const canvas = await html2canvas(element, {
    scale: 1,
    width: 500,
    height: 400,
    useCORS: true,
    backgroundColor: null, // optional, depends on if you want transparency
    onclone: (clonedDocument) => {
      const clonedTarget = (
        element.id
          ? clonedDocument.getElementById(element.id)
          : clonedDocument.querySelector('[id^="lexical-content-"]')
      ) as HTMLElement | null;
      if (clonedTarget) {
        clonedTarget.style.width = "500px";
        clonedTarget.style.height = "400px";
        clonedTarget.style.overflow = "hidden";
        clonedTarget.classList.remove("pt-20", "px-6", "border-x");
        clonedTarget.classList.add("p-2");
        // Future: consider ignoring heavy embeds (iframes/videos/canvas) for speed.
      }
    },
  });
  performance.mark("captured_canvas");

  // restore theme
  restoreTheme();

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to get canvas 2D context");
  }
  performance.mark("got_canvas_context");

  // image data to blob
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/png"),
  );
  if (!blob) {
    throw new Error("Failed to create blob");
  }
  performance.mark("blob_created");

  // Measure all performance marks
  performance.measure("Canvas Capture", "start", "captured_canvas");
  performance.measure(
    "Canvas Context Retrieval",
    "captured_canvas",
    "got_canvas_context",
  );
  performance.measure("Blob Creation", "got_canvas_context", "blob_created");

  // Log performance results
  for (const entry of performance.getEntriesByType("measure")) {
    console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
  }

  // Clear performance marks and measures to avoid clutter
  performance.clearMarks();
  performance.clearMeasures();

  return blob;
}
