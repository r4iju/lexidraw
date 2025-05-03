import {
  $getRoot,
  $isElementNode,
  type NodeKey,
  type EditorState,
  type LexicalNode,
} from "lexical";

export type SerializedNodeWithKey = {
  key: NodeKey;
  type: string;
  version?: number;
  children?: SerializedNodeWithKey[];
  [prop: string]: unknown;
};

export const useSerializeEditorState = () => {
  function serializeNodeWithKeys(
    node: LexicalNode,
  ): SerializedNodeWithKey | null {
    if (!node) return null;

    // 1. Get node-specific properties via exportJSON()
    const exportedJson = node.exportJSON();

    // 2. Base object with key and type (will overwrite if present in exportedJson)
    const serializedNodeBase = {
      key: node.getKey(),
      type: node.getType(),
    };

    // 3. Handle children recursively if it's an ElementNode
    let childrenJson: SerializedNodeWithKey[] | undefined = undefined;
    if ($isElementNode(node)) {
      const children = node.getChildren();
      childrenJson = children
        .map(serializeNodeWithKeys)
        .filter((child): child is SerializedNodeWithKey => child !== null);
    }

    // 4. Merge everything: Base (key/type) + Exported Props + Recursive Children
    const finalSerializedNode = {
      ...exportedJson, // Start with exported properties (like src, alt, version, etc.)
      ...serializedNodeBase, // Ensure our key and type overwrite exportedJson's if they exist
      ...(childrenJson !== undefined && { children: childrenJson }), // Add children if element node
    };

    // Clean up potential version duplication if exportJSON included it
    if ("version" in exportedJson && serializedNodeBase.type !== "root") {
      // Keep version from exportJSON
      // No action needed, spread operator order handles it.
    } else if (!("version" in exportedJson) && "version" in node) {
      // If exportJSON didn't include version, but node has it (e.g. old nodes?), add it.
      // This case might be rare with proper exportJSON overrides.
      // finalSerializedNode.version = (node as any).version;
    }

    return finalSerializedNode;
  }

  function serializeEditorStateWithKeys(editorState: EditorState): {
    root: SerializedNodeWithKey;
  } | null {
    let serializedRoot: SerializedNodeWithKey | null = null;
    try {
      editorState.read(() => {
        serializedRoot = serializeNodeWithKeys($getRoot());
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
  }

  return { serializeEditorStateWithKeys };
};
