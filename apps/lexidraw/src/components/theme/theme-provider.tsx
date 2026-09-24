"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes";

/** Paper is white, so the page a PDF is printed from is light for everyone. */
const PRINT_PAGE = /^\/documents\/[^/]+\/print$/;

export function ThemeProvider({
  children,
  forcedTheme,
  ...props
}: ThemeProviderProps) {
  // next-themes ignores a provider nested in another, so a page cannot force
  // a theme of its own; the root one forces it for the page.
  const pathname = usePathname();
  return (
    <NextThemesProvider
      {...props}
      forcedTheme={PRINT_PAGE.test(pathname ?? "") ? "light" : forcedTheme}
    >
      {children}
    </NextThemesProvider>
  );
}

function subscribeToPageTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/**
 * Whether the page is dark, read from the class next-themes' script puts on
 * <html> before anything paints, so the first render already knows: a canvas
 * that starts light flashes white at a dark reader. It follows a forced theme
 * too, since next-themes sets the class for it.
 */
export function useIsDarkTheme() {
  return useSyncExternalStore(
    subscribeToPageTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}
