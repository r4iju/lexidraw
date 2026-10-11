import { useEffect } from "react";
import { useSendQuery } from "./use-send-query";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_HIGH,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
} from "lexical";
import { useChatState } from "./llm-chat-context";

export function useRegisterKeybindings() {
  const sendQuery = useSendQuery();
  const { mode } = useChatState();
  const [editor] = useLexicalComposerContext();

  // External system: Lexical owns the shortcut command registration.
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null): boolean => {
        if (!event) return false;

        const { metaKey, altKey, ctrlKey, shiftKey } = event;
        const correctModifiers = metaKey && altKey && !ctrlKey && !shiftKey;

        if (correctModifiers) {
          event.preventDefault();
          if (mode !== "chat") {
            void sendQuery({ prompt: "Open document action" });
            return true;
          }

          let promptText = "Explain this selection";

          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection) && !selection.isCollapsed()) {
              promptText = `Explain this text: "${selection.getTextContent()}"`;
            } else {
              promptText = "Explain the current content";
            }
          });

          void sendQuery({ prompt: promptText });
          return true; // command handled
        }
        return false; // command not handled
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, sendQuery, mode]);

  // hook doesn't render anything
  return null;
}
