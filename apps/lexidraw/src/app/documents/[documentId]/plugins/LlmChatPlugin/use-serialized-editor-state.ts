import {
  $getRoot,
  $isElementNode,
  type EditorState,
  type LexicalNode,
} from "lexical";
import type {
  KeyedSerializedEditorState,
  SerializedNodeWithKey,
} from "../../types";
import { useCallback, useRef, useEffect } from "react";

export const useKeyedSerialization = () => {
  const serializeNodeWithKeysRecursiveRef = useRef<
    (node: LexicalNode) => SerializedNodeWithKey | null
  >(() => null);

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

      let childrenJson: SerializedNodeWithKey[] | undefined;
      if ($isElementNode(node)) {
        const children = node.getChildren();

        childrenJson = children
          .map((child) => serializeNodeWithKeysRecursiveRef.current(child))
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

  useEffect(() => {
    serializeNodeWithKeysRecursiveRef.current = serializeNodeWithKeysRecursive;
  }, [serializeNodeWithKeysRecursive]);

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
