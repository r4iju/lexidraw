import type {
  NodeKey,
  ElementFormatType, // For 'format' on element nodes
  TextModeType, // For 'mode' on text nodes
  // Import other necessary Lexical types if you want to be more specific than 'string' or 'number'
} from "lexical";

/**
 * Represents a LexicalNode that has been serialized with its key, type, version,
 * and recursively its children (if an ElementNode).
 * It also includes all other properties exported by the node's exportJSON() method.
 */
export type SerializedNodeWithKey = {
  /** The unique key of the LexicalNode. */
  key: NodeKey;
  /** The type of the LexicalNode (e.g., "paragraph", "text", "custom-node"). */
  type: string;
  /** The version of the LexicalNode. */
  version: number; // Lexical's SerializedLexicalNode mandates version as non-optional.

  /** For ElementNodes: Array of child nodes, also serialized with keys. Undefined for non-ElementNodes. */
  children?: SerializedNodeWithKey[];

  // Common properties from Lexical's SerializedElementNode (RootNode is an ElementNode)
  // These are optional as they only apply to ElementNodes.
  direction?: "ltr" | "rtl" | null;
  format?: ElementFormatType | number; // ElementFormatType (string) for elements, number for text node format bits
  indent?: number;

  // Common properties from Lexical's SerializedTextNode
  // These are optional as they only apply to TextNodes.
  text?: string;
  style?: string;
  mode?: TextModeType;
  detail?: number; // Typically 0 for normal text, or bitmasks for special states

  // To accommodate any other properties exported by specific nodes via their .exportJSON() method.
  // This allows for custom node properties like 'url' for an ImageNode, 'data' for SlideNode, etc.
  [prop: string]: unknown;
};

/**
 * Represents a complete Lexical editor state that has been serialized
 * ensuring that the root node, and all its descendants, include their keys.
 */
export type KeyedSerializedEditorState = {
  /** The root node of the editor state, serialized with its key and recursively for all children. */
  readonly root: SerializedNodeWithKey; // 'readonly' aligns with Lexical's SerializedEditorState
};
