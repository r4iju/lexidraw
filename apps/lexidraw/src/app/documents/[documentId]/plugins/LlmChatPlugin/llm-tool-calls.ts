import {
  createCommand,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  LexicalEditor,
} from "lexical";

export const SEND_SELECTION_TO_LLM_COMMAND = createCommand<{
  prompt: string;
  selectionHtml?: string;
}>();

export const TOGGLE_LLM_CHAT_COMMAND = createCommand();

type ToolCall =
  | {
      name: "insert_text";
      args: { text: string; position: "before" | "after" | "replace" };
    }
  | {
      name: "delete_range";
      args: { from: string; to: string };
    };

export function applyToolCall(editor: LexicalEditor, call: ToolCall) {
  switch (call.name) {
    case "insert_text":
      editor.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) {
          const textNode = $createTextNode(call.args.text);
          const para = $createParagraphNode().append(textNode);
          sel.insertNodes([para]);
        }
      });
      break;

    case "delete_range":
      editor.update(() => {
        console.warn("`delete_range` tool not implemented yet.", call.args);
      });
      break;
  }
}
