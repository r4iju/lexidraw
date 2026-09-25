"use client";

import { useEffect } from "react";
import { keyboardInset } from "~/lib/keyboard-inset";

export default function LayoutListener() {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const measure = () => {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty("--dynamic-viewport-height", `${h}px`);
      root.style.setProperty(
        "--keyboard-inset",
        `${keyboardInset(window.innerHeight, vv ?? undefined)}px`,
      );
    };

    measure();
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);

    return () => {
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return null;
}
