"use client";

import { elementToSVG } from "dom-to-svg";

export const exportLexicalAsSvg = async () => {
  const element = (document.querySelector('[id^="lexical-content-"]') ||
    document.querySelector("#lexical-content")) as HTMLElement;
  if (!element) {
    throw new Error("Lexical content element not found");
  }

  // Work on a detached clone to avoid reflow on the live DOM
  const cloned = element.cloneNode(true) as HTMLElement;
  cloned.style.width = "500px";
  cloned.style.height = "400px";
  cloned.style.overflow = "hidden";
  cloned.classList.remove("pt-20", "px-6", "border-x");
  cloned.classList.add("p-2");

  const svgDocument = elementToSVG(cloned);
  const svgString = new XMLSerializer().serializeToString(svgDocument);

  return svgString;
};
