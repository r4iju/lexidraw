import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { CORE_NODES, CORE_TRANSFORMERS } from "@packages/lexical-nodes";
import {
  $getRoot,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from "lexical";

// Registered implicitly by every Lexical editor.
const BUILTIN_NODE_TYPES = ["root", "paragraph", "text", "linebreak", "tab"];

const SUPPORTED_NODE_TYPES = new Set([
  ...BUILTIN_NODE_TYPES,
  ...CORE_NODES.map((node) => node.getType()),
]);

export class UnsupportedNodeTypesError extends Error {
  readonly types: string[];

  constructor(types: string[]) {
    super(
      `Document contains node types without a markdown form yet: ${types.join(", ")}`,
    );
    this.name = "UnsupportedNodeTypesError";
    this.types = types;
  }
}

export class InvalidDocumentContentError extends Error {
  constructor() {
    super("Document content is not a Lexical editor state");
    this.name = "InvalidDocumentContentError";
  }
}

// documents.create accepts any JSON as content, so stored content is not
// trusted to be an editor state.
export function parseEditorState(elements: string): SerializedEditorState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(elements);
  } catch {
    throw new InvalidDocumentContentError();
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("root" in parsed) ||
    typeof parsed.root !== "object" ||
    parsed.root === null ||
    !("children" in parsed.root) ||
    !Array.isArray(parsed.root.children)
  ) {
    throw new InvalidDocumentContentError();
  }
  return parsed as SerializedEditorState;
}

/** Node types in document order, each listed once. */
export function collectNodeTypes(state: SerializedEditorState): string[] {
  const seen = new Set<string>();
  const visit = (node: SerializedLexicalNode) => {
    seen.add(node.type);
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children as SerializedLexicalNode[]) {
        visit(child);
      }
    }
  };
  visit(state.root);
  return [...seen];
}

export function unsupportedNodeTypes(state: SerializedEditorState): string[] {
  return collectNodeTypes(state).filter(
    (type) => !SUPPORTED_NODE_TYPES.has(type),
  );
}

/**
 * Converts a stored document to markdown with the headless editor. Throws
 * UnsupportedNodeTypesError when the document holds node types the nodes
 * package does not register yet, so the caller can name them.
 */
export function editorStateToMarkdown(state: SerializedEditorState): string {
  const unsupported = unsupportedNodeTypes(state);
  if (unsupported.length > 0) {
    throw new UnsupportedNodeTypesError(unsupported);
  }
  // Lexical refuses to set a state whose root has no children.
  if (state.root.children.length === 0) {
    return "";
  }
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.setEditorState(editor.parseEditorState(state));
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(CORE_TRANSFORMERS, $getRoot()));
}

/** The blocks markdown parses to, as a state whose root holds only them. */
export function markdownToEditorState(markdown: string): SerializedEditorState {
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, CORE_TRANSFORMERS);
    },
    { discrete: true },
  );
  return editor.getEditorState().toJSON();
}

/**
 * `state` with `blocks` after its own children, without touching `state`.
 * Appending serialized nodes keeps blocks that have no markdown form, and any
 * node the running editor would not know how to build, byte-identical: they
 * are never re-parsed or re-serialized.
 */
export function appendBlocks(
  state: SerializedEditorState,
  blocks: SerializedLexicalNode[],
): SerializedEditorState {
  return {
    ...state,
    root: { ...state.root, children: [...state.root.children, ...blocks] },
  };
}

export type DocumentFrontmatter = {
  id: string;
  title: string;
  /** Slash-joined directory titles ending in the document title. */
  path: string;
  updatedAt: Date;
  tags: string[];
};

// JSON string literals are valid YAML double-quoted scalars, so titles with
// colons, quotes, or hashes survive.
const yaml = (value: string) => JSON.stringify(value);

export function withFrontmatter(
  meta: DocumentFrontmatter,
  markdown: string,
): string {
  const lines = [
    "---",
    `id: ${yaml(meta.id)}`,
    `title: ${yaml(meta.title)}`,
    `path: ${yaml(meta.path)}`,
    `updatedAt: ${yaml(meta.updatedAt.toISOString())}`,
    `tags: [${meta.tags.map(yaml).join(", ")}]`,
    "---",
    "",
  ];
  return `${lines.join("\n")}\n${markdown}`;
}
