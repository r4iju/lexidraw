import {
  $createParagraphNode,
  $insertNodes,
  $isRootOrShadowRoot,
  $nodesOfType,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { $wrapNodeInElement } from "@lexical/utils";
import { ImageNode } from "@packages/lexical-nodes";
import type { SaveReceipt } from "../open-entity-sync";

export async function insertRetainedImage(
  editor: LexicalEditor,
  url: string,
  prompt: string,
  persist: (state: EditorState) => Promise<SaveReceipt>,
  check: () => void = () => {},
): Promise<SaveReceipt | null> {
  check();
  if (!editor.isEditable() || !editor.hasNodes([ImageNode])) return null;
  await new Promise<void>((resolve, reject) => {
    try {
      editor.update(
        () => {
          check();
          const existing = $nodesOfType(ImageNode).filter(
            (node) => node.getSrc() === url,
          );
          if (existing.length > 1)
            throw new Error("Duplicate image receipt nodes");
          if (existing.length === 1) return;
          const image = ImageNode.$createImageNode({
            src: url,
            altText: prompt,
          });
          $insertNodes([image]);
          if ($isRootOrShadowRoot(image.getParentOrThrow()))
            $wrapNodeInElement(image, $createParagraphNode).selectEnd();
        },
        { discrete: true, onUpdate: resolve },
      );
    } catch (error) {
      reject(error);
    }
  });
  check();
  return persist(editor.getEditorState());
}
