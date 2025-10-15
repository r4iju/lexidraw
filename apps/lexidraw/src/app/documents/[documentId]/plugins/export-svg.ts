"use client";

import { elementToSVG } from "dom-to-svg";

export const exportLexicalAsSvg = async () => {
  const element = document.querySelector("#lexical-content") as HTMLElement;
  if (!element) {
    throw new Error("#lexical-content element not found");
  }

  const previousWidth = element.style.width;
  const previousHeight = element.style.height;

  element.style.width = "500px";
  element.style.height = "400px";

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const svgDocument = elementToSVG(element);
  const svgString = new XMLSerializer().serializeToString(svgDocument);

  // reset the size
  element.style.width = previousWidth;
  element.style.height = previousHeight;

  return svgString;
};
