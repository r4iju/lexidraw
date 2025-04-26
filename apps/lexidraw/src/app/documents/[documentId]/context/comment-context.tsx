"use client";

import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  PropsWithChildren,
} from "react";
import { createCommand, LexicalCommand } from "lexical";

export const TOGGLE_COMMENTS_COMMAND: LexicalCommand<void> = createCommand(
  "TOGGLE_COMMENTS_COMMAND",
);

interface CommentContextType {
  isCommentPanelOpen: boolean;
  toggleCommentPanel: () => void;
}

const CommentContext = createContext<CommentContextType | null>(null);

export const CommentProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleCommentPanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const contextValue: CommentContextType = {
    isCommentPanelOpen: isOpen,
    toggleCommentPanel,
  };

  return (
    <CommentContext.Provider value={contextValue}>
      {children}
    </CommentContext.Provider>
  );
};

export const useCommentsContext = (): CommentContextType => {
  const context = useContext(CommentContext);
  if (!context) {
    throw new Error("useCommentsContext must be used within a CommentProvider");
  }
  return context;
};
