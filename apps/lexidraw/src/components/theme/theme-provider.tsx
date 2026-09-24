"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  useTheme,
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

export function useIsDarkTheme() {
  const { theme, systemTheme, forcedTheme } = useTheme();
  const [isDarkTheme, setIsDarkTheme] = useState(false);

  useEffect(() => {
    // A page that forces a theme wins over the reader's.
    const chosen = forcedTheme ?? theme;
    const isDark =
      chosen === "dark" || (chosen === "system" && systemTheme === "dark");
    setIsDarkTheme(isDark);
  }, [forcedTheme, theme, systemTheme]);

  return isDarkTheme;
}
