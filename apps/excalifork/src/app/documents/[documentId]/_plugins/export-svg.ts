"use client";

import { elementToSVG } from "dom-to-svg";

export const exportLexicalAsSvg = () => {
  const svgDocument = elementToSVG(
    document.querySelector("#lexical-content") as Element,
  );
  const svgString = new XMLSerializer().serializeToString(svgDocument);

  // const blob = new Blob([svgString], { type: "image/svg+xml" });
  // const url = URL.createObjectURL(blob);
  // const a = document.createElement("a");
  // a.href = url;
  // a.download = "screenshot.svg";
  // a.click();

  return svgString;
};