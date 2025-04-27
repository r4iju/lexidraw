"use client";

import React, { useEffect } from "react";
import { Sidebar } from "./ui/sidebar";
import { LlmChatProvider, useChatDispatch } from "./context/llm-chat-context";
import { useRegisterKeybindings } from "./keybindings/use-register-keybindings";
import { createCommand, type LexicalCommand } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

const ChatPluginCore = (): React.ReactElement => {
  useRegisterKeybindings();
  const dispatch = useChatDispatch();
  const [editor] = useLexicalComposerContext();

  // register command listener
  useEffect(() => {
    return editor.registerCommand(
      TOGGLE_LLM_CHAT_COMMAND,
      () => {
        console.log("TOGGLE_LLM_CHAT_COMMAND received");
        dispatch({ type: "toggleSidebar" });
        return true;
      },
      1, // low priority
    );
  }, [editor, dispatch]);

  return <Sidebar />;
};

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
