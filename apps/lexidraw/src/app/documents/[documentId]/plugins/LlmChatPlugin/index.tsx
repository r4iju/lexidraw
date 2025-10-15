"use client";

import type React from "react";
import { useEffect } from "react";
import { Sidebar } from "./ui/sidebar";
import { LlmChatProvider, useChatDispatch } from "./llm-chat-context";
import { useRegisterKeybindings } from "./use-register-keybindings";
import { createCommand, type LexicalCommand } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RuntimeToolsProvider } from "./runtime-tools-provider";

const ChatPluginCore = (): React.ReactElement => {
  useRegisterKeybindings();
  const dispatch = useChatDispatch();
  const [editor] = useLexicalComposerContext();

  // register command listener
  useEffect(() => {
    return editor.registerCommand(
      TOGGLE_LLM_CHAT_COMMAND,
      () => {
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
      <RuntimeToolsProvider>
        <ChatPluginCore />
      </RuntimeToolsProvider>
    </LlmChatProvider>
  );
}

export const TOGGLE_LLM_CHAT_COMMAND: LexicalCommand<void> = createCommand(
  "TOGGLE_LLM_CHAT_COMMAND",
);
