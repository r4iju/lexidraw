"use client";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import {
  $isRootOrShadowRoot,
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
} from "lexical";
import { $createParagraphNode } from "lexical";

import { MermaidNode } from "../../nodes/MermaidNode";
import { $wrapNodeInElement } from "@lexical/utils";

export const INSERT_MERMAID_COMMAND = createCommand("INSERT_MERMAID");

export default function MermaidPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([MermaidNode])) {
      throw new Error("MermaidNode is not registered on the editor.");
    }

    return editor.registerCommand(
      INSERT_MERMAID_COMMAND,
      () => {
        const node = MermaidNode.$createMermaidNode();
        $insertNodes([node]);
        if ($isRootOrShadowRoot(node.getParentOrThrow()))
          $wrapNodeInElement(node, $createParagraphNode).selectEnd();
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }, [editor]);

  return null;
}
