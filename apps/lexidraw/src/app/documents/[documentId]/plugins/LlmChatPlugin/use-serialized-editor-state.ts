import {
  $getRoot,
  $isElementNode,
  type EditorState,
  type LexicalNode,
} from "lexical";
import { KeyedSerializedEditorState, SerializedNodeWithKey } from "../../types";
import { useCallback } from "react";

export const useKeyedSerialization = () => {
  const serializeNodeWithKeysRecursive = useCallback(
    (node: LexicalNode): SerializedNodeWithKey | null => {
      if (!node) {
        return null;
      }

      const exportedJson = node.exportJSON();

      const serializedNodeBase = {
        key: node.getKey(),
        type: node.getType(),
      };

      let childrenJson: SerializedNodeWithKey[] | undefined = undefined;
      if ($isElementNode(node)) {
        const children = node.getChildren();

        childrenJson = children
          .map((child) => serializeNodeWithKeysRecursive(child))
          .filter((child): child is SerializedNodeWithKey => child !== null);
      }

      const finalSerializedNode = {
        ...exportedJson,
        ...serializedNodeBase, // override key/type from exportedJson if they conflict
        ...(childrenJson !== undefined && { children: childrenJson }),
      };

      return finalSerializedNode;
    },
    [],
  );

  const serializeEditorStateWithKeys = useCallback(
    (editorState: EditorState): KeyedSerializedEditorState | null => {
      let serializedRoot: SerializedNodeWithKey | null = null;
      try {
        editorState.read(() => {
          serializedRoot = serializeNodeWithKeysRecursive($getRoot());
        });
      } catch (error) {
        console.error("Error during editor state read/serialization:", error);
        return null;
      }

      if (!serializedRoot) {
        console.error("Failed to serialize the root node after read.");
        return null;
      }
      return { root: serializedRoot };
    },
    [serializeNodeWithKeysRecursive],
  );

  return { serializeEditorStateWithKeys };
};
