import { $getSelection, $isRangeSelection, LexicalEditor } from "lexical";
import { z } from "zod";

export const useToolExecutors = (editor: LexicalEditor) => {
  const EditTextArgsSchema = z.object({
    newStateJson: z.string().refine(
      (val) => {
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: "newStateJson must be a valid JSON string" },
    ),
    instructions: z.string().optional(),
  });

  const InsertTextArgsSchema = z.object({
    text: z.string(),
  });

  const editTextExecutor = (args: unknown) => {
    const parseResult = EditTextArgsSchema.safeParse(args);
    if (!parseResult.success) {
      console.error("Invalid args for editText:", parseResult.error.errors);
      console.log("args:", args);
      return;
    }
    const { newStateJson } = parseResult.data;

    try {
      const newEditorState = editor.parseEditorState(newStateJson);
      editor.setEditorState(newEditorState);
      console.log("editText executed successfully.");
    } catch (error) {
      console.error(
        "Error setting editor state in editText:",
        error,
        "Input JSON:",
        newStateJson,
      );
    }
  };

  const insertTextExecutor = (args: unknown) => {
    const parseResult = InsertTextArgsSchema.safeParse(args);
    if (!parseResult.success) {
      console.error("Invalid args for insertText:", parseResult.error.errors);
      return;
    }
    const { text } = parseResult.data;

    if (!text) {
      // don't insert empty text
      console.warn("Attempted to insert empty text.");
      return;
    }

    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertText(text);
        console.log(
          `insertText executed successfully with text: "${text.substring(0, 50)}..."`,
        );
      } else {
        console.warn("Cannot insert text: No range selection found.");
        // TODO: define behavior when no selection (e.g., insert at cursor, end of doc?)
      }
    });
  };

  const toolExecutors: Record<string, (args: unknown) => void> = {
    editText: editTextExecutor,
    insertText: insertTextExecutor,
  };

  return { toolExecutors };
};
