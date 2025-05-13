"use client";

import html2canvas from "html2canvas-pro";

type Props = {
  setTheme: () => void;
  restoreTheme: () => void;
};

export function useExportWebp() {
  function dataURItoBlob(dataURI: string) {
    // convert base64 to raw binary data held in a string
    // doesn't handle URLEncoded DataURIs - see SO answer #6850276 for code that does this
    const byteString = atob(dataURI.split(",")[1] as string);

    // separate out the mime component
    const mimeString = (
      (dataURI.split(",")[0] as string).split(":")[1] as string
    ).split(";")[0];

    // write the bytes of the string to an ArrayBuffer
    const ab = new ArrayBuffer(byteString.length);

    // create a view into the buffer
    const ia = new Uint8Array(ab);

    // set the bytes of the buffer to the correct values
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }

    // write the ArrayBuffer to a blob, and you're done
    const blob = new Blob([ab], { type: mimeString });
    return blob;
  }

  async function exportWebp({ setTheme, restoreTheme }: Props): Promise<Blob> {
    const element = document.querySelector("#lexical-content") as HTMLElement;
    if (!element) {
      throw new Error("#lexical-content element not found");
    }

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

    setTheme();

    // Wait for the next animation frame so the layout updates
    await new Promise<number>((resolve) => requestAnimationFrame(resolve));

    // Capture element as PNG using html2canvas
    const canvas = await html2canvas(clonedElement, {
      scale: 2,
      useCORS: true,
      backgroundColor: null, // optional, depends on if you want transparency
      width: 500,
      height: 400,
    });

    // restore theme
    restoreTheme();

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      document.body.removeChild(hiddenContainer); // Cleanup
      throw new Error("Unable to get canvas 2D context");
    }

    // Cleanup: remove the hidden container
    document.body.removeChild(hiddenContainer);

    // image data to blob
    const url = canvas.toDataURL("image/webp");
    const blob = dataURItoBlob(url);
    if (!blob) {
      throw new Error("Failed to create blob");
    }

    return blob;
  }

  return { exportWebp };
}
