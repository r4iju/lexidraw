"use client";

import { useEffect, useState } from "react";
import {
  useTheme,
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}

export function useIsDarkTheme() {
  const { theme, systemTheme } = useTheme();
  const [isDarkTheme, setIsDarkTheme] = useState(false);

  useEffect(() => {
    // Determines if the theme is set to dark or the system theme is dark when the theme is set to 'system'
    const isDark =
      theme === "dark" || (theme === "system" && systemTheme === "dark");
    setIsDarkTheme(isDark);
  }, [theme, systemTheme]);

  return isDarkTheme;
}
