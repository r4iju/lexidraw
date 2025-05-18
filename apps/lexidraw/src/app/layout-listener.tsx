"use client";

import { useEffect } from "react";

export default function LayoutListener() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const setHeight = () => {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty("--dynamic-viewport-height", `${h}px`);
    };

    setHeight(); // ① run once on mount
    vv?.addEventListener("resize", setHeight);
    window.addEventListener("resize", setHeight); // fallback for old browsers

    return () => {
      vv?.removeEventListener("resize", setHeight);
      window.removeEventListener("resize", setHeight);
    };
  }, []);

  return null;
}
