"use client";

import type React from "react";
import {
  createContext,
  useContext,
  useState,
  useMemo,
  type PropsWithChildren,
  useCallback,
  useEffect,
} from "react";

export type ActiveSidebar = "llm" | "comments" | "toc" | "tree" | null;

interface SidebarManagerContextProps {
  activeSidebar: ActiveSidebar;
  setActiveSidebar: (sidebar: ActiveSidebar) => void;
  toggleSidebar: (sidebar: Exclude<ActiveSidebar, null>) => void;
}

const SidebarManagerContext = createContext<
  SidebarManagerContextProps | undefined
>(undefined);

const SIDEBAR_LOCALSTORAGE_KEY = "lexidraw.sidebar";

export const SidebarManagerProvider: React.FC<PropsWithChildren<unknown>> = ({
  children,
}) => {
  const [activeSidebar, setActiveSidebarState] = useState<ActiveSidebar>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(SIDEBAR_LOCALSTORAGE_KEY);
      if (stored === "llm" || stored === "comments" || stored === "toc") {
        return stored as ActiveSidebar;
      }
    }
    return null;
  });

  // persist to localStorage when activeSidebar changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (activeSidebar) {
        window.localStorage.setItem(SIDEBAR_LOCALSTORAGE_KEY, activeSidebar);
      } else {
        window.localStorage.removeItem(SIDEBAR_LOCALSTORAGE_KEY);
      }
    }
  }, [activeSidebar]);

  const setActiveSidebar = useCallback((sidebar: ActiveSidebar) => {
    setActiveSidebarState(sidebar);
  }, []);

  const toggleSidebar = useCallback((sidebar: Exclude<ActiveSidebar, null>) => {
    setActiveSidebarState((prev) => (prev === sidebar ? null : sidebar));
  }, []);

  const value = useMemo(
    () => ({
      activeSidebar,
      setActiveSidebar,
      toggleSidebar,
    }),
    [activeSidebar, setActiveSidebar, toggleSidebar],
  );

  return (
    <SidebarManagerContext.Provider value={value}>
      {children}
    </SidebarManagerContext.Provider>
  );
};

export const useSidebarManager = (): SidebarManagerContextProps => {
  const context = useContext(SidebarManagerContext);
  if (context === undefined) {
    throw new Error(
      "useSidebarManager must be used within a SidebarManagerProvider",
    );
  }
  return context;
};
