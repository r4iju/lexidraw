"use client";

import html2canvas from "html2canvas-pro";

type Props = {
  setTheme: () => void;
  restoreTheme: () => void;
};

export async function exportDomTracedSvg({
  setTheme,
  restoreTheme,
}: Props): Promise<string> {
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
        // Future: consider ignoring heavy embeds for speed.
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

  const { width: finalWidth, height: finalHeight } = canvas;
  const imgData = ctx.getImageData(0, 0, finalWidth, finalHeight);
  performance.mark("got_image_data");

  // Offload tracing to a Web Worker
  const worker = new Worker(new URL("./trace-worker.js", import.meta.url));
  performance.mark("opened_worker");

  const options = {
    ltres: 1,
    qtres: 1,
    colorsampling: 2,
    pathomit: 0,
    blurradius: 0,
    blurdelta: 20,
  };

  const result = await new Promise<string>((resolve, reject) => {
    worker.onmessage = (e) => {
      const { tracedSvgString } = e.data;
      resolve(tracedSvgString);
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    worker.postMessage({ imgData, options });
  });
  performance.mark("got_traced_svg_string_from_worker");

  // Measure all performance marks
  performance.measure("Canvas Capture", "start", "captured_canvas");
  performance.measure(
    "Canvas Context Retrieval",
    "captured_canvas",
    "got_canvas_context",
  );
  performance.measure(
    "Image Data Extraction",
    "got_canvas_context",
    "got_image_data",
  );
  performance.measure("Worker Open", "got_image_data", "opened_worker");
  performance.measure(
    "Traced SVG Generation",
    "opened_worker",
    "got_traced_svg_string_from_worker",
  );

  // Log performance results
  for (const entry of performance.getEntriesByType("measure")) {
    console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
  }

  // Clear performance marks and measures to avoid clutter
  performance.clearMarks();
  performance.clearMeasures();

  return result;
}
