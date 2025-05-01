"use client";

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  PropsWithChildren,
  useCallback,
} from "react";

export type ActiveSidebar = "llm" | "comments" | "toc" | null;

interface SidebarManagerContextProps {
  activeSidebar: ActiveSidebar;
  setActiveSidebar: (sidebar: ActiveSidebar) => void;
  toggleSidebar: (sidebar: Exclude<ActiveSidebar, null>) => void; // Helper to toggle specific sidebar
}

const SidebarManagerContext = createContext<
  SidebarManagerContextProps | undefined
>(undefined);

export const SidebarManagerProvider: React.FC<PropsWithChildren<unknown>> = ({
  children,
}) => {
  const [activeSidebar, setActiveSidebarState] = useState<ActiveSidebar>(null);

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
