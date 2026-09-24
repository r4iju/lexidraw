"use client";

import { useEffect, useRef } from "react";

/**
 * Cmd+S (Ctrl+S elsewhere) saves the open entity, instead of the browser's
 * save dialog or a canvas's own file save. Shift+S is left alone: it is
 * strikethrough in a document, and "save as" in a drawing. Null, for someone
 * who cannot save, leaves the keys alone.
 */
export function useSaveShortcut(save: (() => void) | null) {
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  }, [save]);
  const enabled = save !== null;

  // External system: the window's keys, caught before anything on the page.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "KeyS" ||
        event.shiftKey ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      latest.current?.();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [enabled]);
}

/** How a menu shows the shortcut; only in the browser, where menus open. */
export function saveShortcutLabel(): string {
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘S" : "Ctrl+S";
}
