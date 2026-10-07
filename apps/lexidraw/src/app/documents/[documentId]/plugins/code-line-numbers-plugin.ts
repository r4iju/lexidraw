import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { DocumentCodeNode } from "@packages/lexical-nodes";
import { $isLineBreakNode, $nodesOfType } from "lexical";
import { useEffect } from "react";

/**
 * Marks the first element of every code line with its number, which the
 * stylesheet shows in a gutter when a block's line numbers are on. Every
 * renderer of code mounts it, so iOS images and read views number lines too.
 */
export default function CodeLineNumbersPlugin(): null {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerMutationListener(
        DocumentCodeNode,
        () => {
          editor.getEditorState().read(() => {
            for (const node of $nodesOfType(DocumentCodeNode)) {
              let line = 1;
              let first = true;
              for (const child of node.getChildren()) {
                const dom = editor.getElementByKey(child.getKey());
                if (dom) {
                  dom.removeAttribute("data-line-number");
                  if (first) dom.dataset.lineNumber = String(line);
                }
                if ($isLineBreakNode(child)) {
                  line++;
                  first = true;
                } else first = false;
              }
            }
          });
        },
        { skipInitialization: false },
      ),
    [editor],
  );
  return null;
}
