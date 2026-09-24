"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /** Read by the page renderer, which captures the page once it is true. */
    __readyForPdf__?: boolean;
  }
}

/** How long nothing on the page may change before it counts as settled. */
const QUIET_MS = 500;
/** How long to wait for that before the page is captured as it stands. */
const GIVE_UP_MS = 20_000;

/**
 * Tells a page renderer when the document is ready to capture: once its
 * fonts have loaded, no block is marked busy, every image has loaded, and
 * nothing has changed for a moment. A block that never settles costs a slow
 * capture rather than none.
 */
export default function RenderReadyPlugin() {
  useEffect(() => {
    window.__readyForPdf__ = false;
    const started = Date.now();
    let lastChange = started;
    let fontsLoaded = false;
    void document.fonts.ready.then(() => {
      fontsLoaded = true;
    });
    const observer = new MutationObserver(() => {
      lastChange = Date.now();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const now = Date.now();
      const settled =
        fontsLoaded &&
        document.querySelector("[id^='lexical-content-']") !== null &&
        document.querySelector("[aria-busy='true']") === null &&
        [...document.images].every((image) => image.complete) &&
        now - lastChange >= QUIET_MS;
      if (settled || now - started >= GIVE_UP_MS) {
        observer.disconnect();
        window.__readyForPdf__ = true;
        return;
      }
      timer = setTimeout(check, 100);
    };
    check();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);
  return null;
}
