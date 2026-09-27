import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { registerDocumentEditing } from "@packages/lexical-nodes";
import { useEffect } from "react";

/** Lists, checklists and Tab, as `registerDocumentEditing` describes them. */
export default function DocumentEditingPlugin(): null {
  const [editor] = useLexicalComposerContext();
  // Registers with the Lexical editor, and unregisters when it changes.
  useEffect(() => registerDocumentEditing(editor), [editor]);
  return null;
}
