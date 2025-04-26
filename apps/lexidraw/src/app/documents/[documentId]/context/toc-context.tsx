"use client";

import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  PropsWithChildren,
} from "react";
import { createCommand, LexicalCommand } from "lexical";

export const TOGGLE_TOC_COMMAND: LexicalCommand<void> =
  createCommand("TOGGLE_TOC_COMMAND");

interface TocContextType {
  isTocOpen: boolean;
  toggleToc: () => void;
  setTocOpen: (open: boolean) => void;
}

const TocContext = createContext<TocContextType | null>(null);

export const TocProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleToc = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const contextValue: TocContextType = {
    isTocOpen: isOpen,
    toggleToc,
    setTocOpen: setIsOpen,
  };

  return (
    <TocContext.Provider value={contextValue}>{children}</TocContext.Provider>
  );
};

export const useTocContext = (): TocContextType => {
  const context = useContext(TocContext);
  if (!context) {
    throw new Error("useTocContext must be used within a TocProvider");
  }
  return context;
};
