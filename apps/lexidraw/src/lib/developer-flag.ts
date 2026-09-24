import { useEffect, useSyncExternalStore } from "react";

const KEY = "lexidraw-developer";
const listeners = new Set<() => void>();

function read() {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setDeveloperFlag(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "on");
    else window.localStorage.removeItem(KEY);
  } catch {}
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Whether this browser shows the tools for working on the editor itself.
 * `?developer=on` (or `off`) in any editor URL sets it.
 */
export function useDeveloperFlag() {
  useEffect(() => {
    const value = new URLSearchParams(location.search).get("developer");
    if (value === "on" || value === "off") setDeveloperFlag(value === "on");
  }, []);
  return useSyncExternalStore(subscribe, read, () => false);
}
