import { LexicalEditor, SerializedEditorState } from "lexical";
import { type ChatToolCall } from "./store";

// Define specific arg types matching the tool definitions
type EditTextArgs = { newStateJson: string; instructions?: string };

export function useToolcall() {
  /**
   * Executes editor modifications based on a tool call.
   * Currently only supports full document replacement via editText.
   */
  function executeEditorToolCall(
    editor: LexicalEditor,
    payload: { toolCall: ChatToolCall },
  ) {
    const { toolCall } = payload;

    if (toolCall.toolName === "editText") {
      const args = toolCall.args as Partial<EditTextArgs>; // Use Partial for safety
      const newStateJson = args.newStateJson;

      if (typeof newStateJson !== "string") {
        console.warn(
          "editText tool call missing valid newStateJson string.",
          args,
        );
        return;
      }

      console.log("Executing full document update from received JSON state.");
      try {
        // 1. Parse the JSON string
        const parsedState = JSON.parse(newStateJson) as SerializedEditorState;
        // 2. Create a new EditorState object
        const newEditorState = editor.parseEditorState(parsedState);
        // 3. Set the editor state
        editor.setEditorState(newEditorState);
        console.log("Successfully set editor state from JSON.");
      } catch (error) {
        console.error(
          "Error processing or setting editor state from JSON:",
          error,
        );
      }
    } else {
      console.warn(
        `Unsupported tool name in executeEditorToolCall: ${toolCall.toolName}`,
      );
    }
  }

  return { executeEditorToolCall };
}
