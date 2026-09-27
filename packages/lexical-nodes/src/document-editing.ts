import { registerTabIndentation } from "@lexical/extension";
import {
  $getListDepth,
  $isListItemNode,
  $isListNode,
  registerCheckList,
  registerList,
} from "@lexical/list";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  type ElementNode,
  INDENT_CONTENT_COMMAND,
  type LexicalEditor,
  mergeRegister,
  type RangeSelection,
} from "lexical";

/** How deep lists nest before indenting stops. */
const MAX_LIST_DEPTH = 6;

/**
 * The document editor's lists, checklists, how deep lists nest, and Tab and
 * the indent commands. The web editor registers it, and so does the iOS
 * reference, so LexicalSwift is held to what the web does. The checklist
 * registers a root listener for its pointer handling.
 */
export function registerDocumentEditing(editor: LexicalEditor): () => void {
  return mergeRegister(
    registerList(editor),
    // Registered before Tab indentation, which indents at the same priority.
    registerListMaxIndentLevel(editor, MAX_LIST_DEPTH),
    registerCheckList(editor),
    registerTabIndentation(editor),
  );
}

/** Refuses to indent a list item past `maxDepth` levels of list. */
function registerListMaxIndentLevel(
  editor: LexicalEditor,
  maxDepth: number,
): () => void {
  return editor.registerCommand(
    INDENT_CONTENT_COMMAND,
    () => $isIndentTooDeep(maxDepth),
    COMMAND_PRIORITY_CRITICAL,
  );
}

function $isIndentTooDeep(maxDepth: number): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  let totalDepth = 0;
  for (const elementNode of elementNodesInSelection(selection)) {
    if ($isListNode(elementNode)) {
      totalDepth = Math.max($getListDepth(elementNode) + 1, totalDepth);
    } else if ($isListItemNode(elementNode)) {
      const parent = elementNode.getParent();
      if (!$isListNode(parent)) {
        throw new Error("A ListItemNode must have a ListNode for a parent.");
      }
      totalDepth = Math.max($getListDepth(parent) + 1, totalDepth);
    }
  }
  return totalDepth > maxDepth;
}

function elementNodesInSelection(selection: RangeSelection): Set<ElementNode> {
  const nodesInSelection = selection.getNodes();
  if (nodesInSelection.length === 0) {
    return new Set([
      selection.anchor.getNode().getParentOrThrow(),
      selection.focus.getNode().getParentOrThrow(),
    ]);
  }
  return new Set(
    nodesInSelection.map((n) => ($isElementNode(n) ? n : n.getParentOrThrow())),
  );
}
