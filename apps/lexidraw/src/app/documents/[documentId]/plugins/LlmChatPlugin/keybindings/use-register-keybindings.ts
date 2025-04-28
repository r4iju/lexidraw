import { useEffect } from "react";
import { useSendQuery } from "../actions/use-send-query";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_HIGH,
  $getSelection,
  $isRangeSelection,
  KEY_ENTER_COMMAND,
} from "lexical";
import { mergeRegister } from "@lexical/utils";

export function useRegisterKeybindings() {
  const sendQuery = useSendQuery();
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent): boolean => {
          if (!event) return false;

          const { metaKey, altKey, ctrlKey, shiftKey } = event;
          const correctModifiers = metaKey && altKey && !ctrlKey && !shiftKey;

          if (correctModifiers) {
            event.preventDefault();
            console.log("Cmd+Alt+Enter detected, sending query...");

            let promptText = "Explain this selection";
            let stateJson: string | undefined;

            editor.getEditorState().read(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection) && !selection.isCollapsed()) {
                promptText = `Explain this text: "${selection.getTextContent()}"`;
              } else {
                // no selection, send entire editor state
                promptText = "Explain the current content";
                stateJson = JSON.stringify(editor.getEditorState().toJSON());
              }
            });

            void sendQuery({ prompt: promptText, editorStateJson: stateJson });
            return true; // command handled
          }
          return false; // command not handled
        },
        COMMAND_PRIORITY_HIGH, // high priority to potentially override other Enter handlers
      ),
      // any other keybindings needed?
      // editor.registerCommand(...)
    );
  }, [editor, sendQuery]);

  // hook doesn't render anything
  return null;
}
