"use client";

import html2canvas from "html2canvas";

type Props = {
  setTheme: () => void;
  restoreTheme: () => void;
}

export async function exportDomTracedSvg({ setTheme, restoreTheme }: Props): Promise<string> {
  const element = document.querySelector("#lexical-content") as HTMLElement;
  if (!element) {
    throw new Error("#lexical-content element not found");
  }

  // Start performance tracing
  performance.mark("start");

  // Create a hidden container
  const hiddenContainer = document.createElement("div");
  hiddenContainer.style.position = "absolute";
  hiddenContainer.style.top = "-9999px";
  hiddenContainer.style.left = "-9999px";
  hiddenContainer.style.width = "0";
  hiddenContainer.style.height = "0";
  // hiddenContainer.style.visibility = "hidden";

  // Clone the element
  const clonedElement = element.cloneNode(true) as HTMLElement;
  clonedElement.style.width = "500px";
  clonedElement.style.height = "400px";
  clonedElement.classList.remove("pt-20", "px-6", "border-x");
  clonedElement.classList.add("p-2");

  // Append the clone to the hidden container
  hiddenContainer.appendChild(clonedElement);
  document.body.appendChild(hiddenContainer);

  setTheme()

  // Wait for the next animation frame so the layout updates
  await new Promise<number>((resolve) => requestAnimationFrame(resolve));
  performance.mark("resized_dom_element");

  // Capture element as PNG using html2canvas
  const canvas = await html2canvas(clonedElement, {
    scale: 3,
    useCORS: true,
    backgroundColor: null, // optional, depends on if you want transparency
  });
  performance.mark("captured_canvas");

  // restore theme
  restoreTheme()

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    document.body.removeChild(hiddenContainer); // Cleanup
    throw new Error("Unable to get canvas 2D context");
  }
  performance.mark("got_canvas_context");

  const { width: finalWidth, height: finalHeight } = canvas;
  const imgData = ctx.getImageData(0, 0, finalWidth, finalHeight);
  performance.mark("got_image_data");

  // Cleanup: remove the hidden container
  document.body.removeChild(hiddenContainer);
  performance.mark("cleaned_up_clone");

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
    worker.onmessage = function (e) {
      const { tracedSvgString } = e.data;
      resolve(tracedSvgString);
      worker.terminate();
    };
    worker.onerror = function (err) {
      reject(err);
      worker.terminate();
    };

    worker.postMessage({ imgData, options });
  });
  performance.mark("got_traced_svg_string_from_worker");

  // Measure all performance marks
  performance.measure("DOM Resizing", "start", "resized_dom_element");
  performance.measure("Canvas Capture", "resized_dom_element", "captured_canvas");
  performance.measure("Canvas Context Retrieval", "captured_canvas", "got_canvas_context");
  performance.measure("Image Data Extraction", "got_canvas_context", "got_image_data");
  performance.measure("Cleanup Clone", "got_image_data", "cleaned_up_clone");
  performance.measure("Worker Open", "cleaned_up_clone", "opened_worker");
  performance.measure("Traced SVG Generation", "opened_worker", "got_traced_svg_string_from_worker");

  // Log performance results
  performance.getEntriesByType("measure").forEach((entry) =>
    console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`)
  );

  // Clear performance marks and measures to avoid clutter
  performance.clearMarks();
  performance.clearMeasures();

  return result;
}
