"use client";

import React, { useEffect } from "react";
import { Sidebar } from "./ui/sidebar";
import { LlmChatProvider, useChatDispatch } from "./context/LlmChatContext";
import { useRegisterKeybindings } from "./keybindings/useRegisterKeybindings";
import { createCommand, type LexicalCommand } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

const ChatPluginCore = (): React.ReactElement => {
  useRegisterKeybindings();
  const dispatch = useChatDispatch();
  const [editor] = useLexicalComposerContext();

  // Effect to register the command listener
  useEffect(() => {
    // Register listener for the toggle command
    return editor.registerCommand(
      TOGGLE_LLM_CHAT_COMMAND,
      () => {
        console.log("TOGGLE_LLM_CHAT_COMMAND received");
        dispatch({ type: "toggleSidebar" });
        return true;
      },
      1,
    );
  }, [editor, dispatch]);

  return <Sidebar />;
};

/**
 * Main component for the LLM Chat Plugin.
 * It sets up the context provider, which then renders the core logic and UI.
 */
export function LlmChatPlugin(): React.ReactElement {
  return (
    <LlmChatProvider>
      <ChatPluginCore />
    </LlmChatProvider>
  );
}

export const TOGGLE_LLM_CHAT_COMMAND: LexicalCommand<void> = createCommand(
  "TOGGLE_LLM_CHAT_COMMAND",
);
