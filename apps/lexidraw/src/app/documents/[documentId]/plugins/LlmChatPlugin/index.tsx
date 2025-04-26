"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_LOW,
  KEY_MODIFIER_COMMAND,
  COMMAND_PRIORITY_HIGH,
  $getSelection,
  $isRangeSelection,
} from "lexical";
import React, { useEffect } from "react";
import { Sidebar } from "./ui/sidebar";
import { LlmChatProvider, useLlmChat } from "./store";
import {
  SEND_SELECTION_TO_LLM_COMMAND,
  TOGGLE_LLM_CHAT_COMMAND,
  EXECUTE_LLM_TOOL_CALL_COMMAND,
} from "./llm-tool-calls";
import { useToolcall } from "./tool-executor";

export { TOGGLE_LLM_CHAT_COMMAND, useLlmChat };

function LlmChatController() {
  const [editor] = useLexicalComposerContext();
  const { sendQuery, toggleSidebar } = useLlmChat();
  const { executeEditorToolCall } = useToolcall();
  useEffect(() => {
    const unregisterKeyCommand = editor.registerCommand(
      KEY_MODIFIER_COMMAND,
      (event) => {
        if (event.metaKey && event.altKey && event.key === "Enter") {
          const selection = editor.getEditorState().read(() => $getSelection());
          let selectionHtml: string | undefined = undefined;
          if ($isRangeSelection(selection)) {
            selectionHtml = selection.getTextContent().substring(0, 100);
            console.log("Selection for LLM:", selectionHtml);
          }
          sendQuery({ prompt: "Explain this selection", selectionHtml });
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const unregisterSendSelectionCommand = editor.registerCommand(
      SEND_SELECTION_TO_LLM_COMMAND,
      (payload) => {
        const currentSelectionHtml = editor.getEditorState().read(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            return selection.getTextContent().substring(0, 100);
          }
          return undefined;
        });
        sendQuery({
          prompt: payload.prompt,
          selectionHtml: payload.selectionHtml ?? currentSelectionHtml,
        });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    const unregisterToggleCommand = editor.registerCommand(
      TOGGLE_LLM_CHAT_COMMAND,
      () => {
        toggleSidebar();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    const unregisterExecuteToolCall = editor.registerCommand(
      EXECUTE_LLM_TOOL_CALL_COMMAND,
      (payload) => {
        editor.update(() => {
          executeEditorToolCall(editor, payload);
        });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      unregisterKeyCommand();
      unregisterSendSelectionCommand();
      unregisterToggleCommand();
      unregisterExecuteToolCall();
    };
  }, [editor, executeEditorToolCall, sendQuery, toggleSidebar]);

  return null;
}

export function LlmChatPlugin() {
  return (
    <LlmChatProvider>
      <LlmChatController />
      <Sidebar />
    </LlmChatProvider>
  );
}
