/**
 * The editor-model interface over headless Lexical, for ReferenceEditor.swift
 * to call with JSON strings.
 */
import { $exportMimeTypeFromSelection } from "@lexical/clipboard";
import { namedSignals } from "@lexical/extension";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $createLinkNode,
  $isAutoLinkNode,
  registerAutoLink,
  registerLink,
  TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import { registerMarkdownShortcuts } from "@lexical/markdown";
import { $isAtNodeEnd } from "@lexical/selection";
import {
  $setBlockType,
  type BlockType,
} from "@packages/lexical-nodes/block-type";
import {
  $isListItemNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  type ListType,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { registerRichText } from "@lexical/rich-text";
import { registerDocumentEditing } from "@packages/lexical-nodes/document-editing";
import {
  AUTOLINK_MATCHERS,
  EDITOR_NAMESPACE,
  validateUrl,
} from "@packages/lexical-nodes/links";
import { SCHEMA_NODES } from "@packages/lexical-nodes/nodes";
import { createTransformers } from "@packages/lexical-nodes/transformers";
import {
  $createRangeSelection,
  $exportNodeJSON,
  $formatText,
  $getEditor,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $getSlot,
  $getSlotNames,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $selectAll,
  $setSelection,
  COMPOSITION_END_TAG,
  COMMAND_PRIORITY_LOW,
  CUT_TAG,
  DELETE_CHARACTER_COMMAND,
  HISTORIC_TAG,
  INDENT_CONTENT_COMMAND,
  INTERNAL_$expandSelectionToWholeDocument,
  IS_ALL_FORMATTING,
  KEY_ENTER_COMMAND,
  type EditorState,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  OUTDENT_CONTENT_COMMAND,
  PASTE_COMMAND,
  type PasteCommandType,
  type PointType,
  REDO_COMMAND,
  type RangeSelection,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import {
  $deleteCharacter,
  $deleteLine,
  $deleteWord,
  $normalizeSelectionPointsForBoundaries,
} from "./deletion.js";
import { EditorError } from "./editor-error.js";

type PathPoint = { path: number[]; offset: number; type: "text" | "element" };

/** `Clipboard` in EditorModel.swift. */
type Clipboard = {
  "text/plain": string;
  "text/html"?: string;
  "application/x-lexical-editor"?: unknown;
};

type Command =
  | { type: "setSelection"; anchor: PathPoint; focus: PathPoint }
  | { type: "insertText" | "commitComposition"; text: string }
  | { type: "deleteCharacter" | "deleteWord"; backward: boolean }
  | { type: "deleteLine"; backward: boolean; lineBoundary: PathPoint }
  | { type: "insertParagraph" }
  | { type: "insertLineBreak" }
  | { type: "formatText"; format: TextFormatType }
  | { type: "setBlockType"; blockType: BlockType }
  | { type: "insertList"; listType: ListType }
  | { type: "removeList" | "indent" | "outdent" }
  | { type: "tab"; backward: boolean }
  | { type: "toggleChecked"; path: number[] }
  | { type: "toggleLink"; url: string | null }
  | { type: "editLink"; url: string }
  | { type: "copy" | "cut" }
  | { type: "paste"; clipboard: Clipboard }
  | { type: "selectAll" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "wait"; milliseconds: number };

let editor: LexicalEditor | null = null;
let lastError: unknown = null;
/**
 * What the updates a command makes change. A shortcut is an update of its
 * own after the command's, which the command's change set takes in.
 */
const changed = new Set<NodeKey>();
/** What the command being applied put on the clipboard. */
let clipboard: Clipboard | undefined;
/** The clock history reads, which only `wait` moves. */
let now = 0;

function current(): LexicalEditor {
  if (!editor) throw new EditorError("invalidState", "No document loaded");
  return editor;
}

function load(stateJSON: string): void {
  const next = createHeadlessEditor({
    namespace: EDITOR_NAMESPACE,
    nodes: SCHEMA_NODES,
    onError: (error) => {
      lastError = error;
    },
  });
  lastError = null;
  const parsed = next.parseEditorState(stateJSON);
  // Parsing reports a bad node through onError and returns an empty state.
  if (lastError) throw lastError;
  now = 0;
  // Registered first, so the loaded document is where undoing stops.
  registerHistory(next, createEmptyHistoryState(), 1000, () => now);
  registerRichText(next);
  // A headless editor refuses root listeners, where an editor without a root
  // element calls them only with none; the checklist's pointer handling
  // registers one, which does nothing without a root.
  next.registerRootListener = () => () => {};
  registerDocumentEditing(next);
  // Rich text deletes through the DOM's selection, which a headless editor
  // hasn't got.
  next.registerCommand(
    DELETE_CHARACTER_COMMAND,
    (isBackward) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      $deleteCharacter(selection, isBackward);
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
  // The document editor's link plugins, in the order it mounts them.
  registerAutoLink(next, {
    changeHandlers: [],
    excludeParents: [],
    matchers: AUTOLINK_MATCHERS,
  });
  registerLink(next, namedSignals({ attributes: undefined, validateUrl }));
  next.setEditorState(parsed);
  next.registerUpdateListener(
    ({ dirtyElements, dirtyLeaves, editorState, prevEditorState, tags }) => {
      const keys = tags.has(HISTORIC_TAG)
        ? replacedKeys(prevEditorState, editorState)
        : [
            ...dirtyLeaves,
            ...[...dirtyElements]
              .filter(([, intentional]) => intentional)
              .map(([key]) => key),
          ];
      for (const key of keys) changed.add(key);
    },
  );
  registerMarkdownShortcuts(next, createTransformers());
  editor = next;
}

function apply(commandJSON: string): string {
  const command = JSON.parse(commandJSON) as Command;
  lastError = null;
  changed.clear();
  clipboard = undefined;
  switch (command.type) {
    case "undo":
    case "redo":
      current().dispatchCommand(
        command.type === "undo" ? UNDO_COMMAND : REDO_COMMAND,
        undefined,
      );
      break;
    case "wait":
      now += command.milliseconds;
      break;
    case "commitComposition":
      current().update(() => run(command), {
        discrete: true,
        tag: COMPOSITION_END_TAG,
      });
      break;
    case "cut":
      cut();
      break;
    default:
      current().update(() => run(command), { discrete: true });
  }
  commitQueuedUpdates();
  if (lastError) throw lastError;
  const paths = current().read(() =>
    [...changed].flatMap((key) => {
      const node = $getNodeByKey(key);
      return node ? [pathOf(node)] : [];
    }),
  );
  return JSON.stringify({ changed: paths, clipboard });
}

/**
 * History commits the state it restores, and a markdown shortcut the update
 * it queues, in a microtask, before anything else a user could do. Reading
 * commits them now, and a shortcut's update can queue another.
 */
function commitQueuedUpdates(): void {
  for (;;) {
    const before = current().getEditorState();
    current().read(() => {});
    if (current().getEditorState() === before) return;
  }
}

/**
 * Rich text's cut, as two updates: one widens a selection of the whole
 * document to its blocks and copies it, and the next deletes it.
 */
function cut(): void {
  current().update(
    () => {
      const selection = rangeSelection();
      if (!selection.isCollapsed()) {
        INTERNAL_$expandSelectionToWholeDocument(selection);
      }
      clipboard = copy(selection);
    },
    { discrete: true, tag: CUT_TAG },
  );
  if (lastError) return;
  current().update(() => rangeSelection().removeText(), {
    discrete: true,
    tag: CUT_TAG,
  });
}

/**
 * What a copy puts on the clipboard, which is nothing for a collapsed
 * selection. The HTML Lexical would add needs a DOM.
 */
function copy(selection: RangeSelection): Clipboard | undefined {
  if (selection.isCollapsed()) return undefined;
  const lexical = $exportMimeTypeFromSelection(
    "application/x-lexical-editor",
    selection,
  );
  return {
    "text/plain": $exportMimeTypeFromSelection("text/plain", selection) ?? "",
    ...(lexical === null
      ? {}
      : { "application/x-lexical-editor": JSON.parse(lexical) as unknown }),
  };
}

/**
 * A paste as the web editor takes it: its link plugin's handler first, which
 * links selected text to a pasted URL, then rich text's.
 */
function paste(pasted: Clipboard): void {
  const event = new ClipboardEvent(dataTransfer(pasted));
  current().dispatchCommand(
    PASTE_COMMAND,
    event as unknown as PasteCommandType,
  );
}

/**
 * The DOM's events, as far as Lexical's paste handlers read one. They tell
 * them apart by their classes' names, from the globals of those names.
 */
const ClipboardEvent = class ClipboardEvent {
  constructor(readonly clipboardData: DataTransfer) {}
  preventDefault(): void {}
};
Object.assign(globalThis, {
  ClipboardEvent,
  DragEvent: class DragEvent {},
  InputEvent: class InputEvent {},
  KeyboardEvent: class KeyboardEvent {},
});

/** A `DataTransfer` holding `pasted`, as far as Lexical reads one. */
function dataTransfer(pasted: Clipboard): DataTransfer {
  const lexical = pasted["application/x-lexical-editor"];
  const data: Record<string, string | undefined> = {
    "text/plain": pasted["text/plain"],
    "text/html": pasted["text/html"],
    "application/x-lexical-editor":
      lexical === undefined ? undefined : JSON.stringify(lexical),
  };
  return {
    types: Object.keys(data).filter((type) => data[type] !== undefined),
    files: [],
    // "text" is the DOM's old name for plain text, which the link plugin uses.
    getData: (type: string) =>
      data[type === "text" ? "text/plain" : type] ?? "",
  } as unknown as DataTransfer;
}

function rangeSelection(): RangeSelection {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    throw new EditorError("noSelection", "No range selection");
  }
  return selection;
}

/**
 * The nodes undo or redo changed, which mark nothing dirty as they swap in a
 * saved state whole. An update copies each node it changes, so these are the
 * nodes that aren't the same object in both states.
 */
function replacedKeys(before: EditorState, after: EditorState): string[] {
  return [...after._nodeMap]
    .filter(([key, node]) => before._nodeMap.get(key) !== node)
    .map(([key]) => key);
}

function snapshot(): string {
  const state = current().getEditorState();
  return state.read(() =>
    JSON.stringify({ state: state.toJSON(), selection: pathSelection() }),
  );
}

function selection(): string {
  return current()
    .getEditorState()
    .read(() => JSON.stringify(pathSelection()));
}

function node(pathJSON: string): string {
  return current()
    .getEditorState()
    .read(() => JSON.stringify(exportNode(nodeAt(JSON.parse(pathJSON)))));
}

function childKeys(pathJSON: string): string {
  return current()
    .getEditorState()
    .read(() => {
      const node = nodeAt(JSON.parse(pathJSON));
      return JSON.stringify($isElementNode(node) ? node.getChildrenKeys() : []);
    });
}

function pathSelection() {
  const selection = $getSelection();
  return $isRangeSelection(selection)
    ? {
        anchor: pathPoint(selection.anchor),
        focus: pathPoint(selection.focus),
        format: selection.format,
        style: selection.style,
      }
    : null;
}

/**
 * A node as `EditorState.toJSON` writes it, children and slots included:
 * Lexical's own `$exportNodeToJSON`, which it doesn't export.
 */
type ExportedNode = ReturnType<typeof $exportNodeJSON> & {
  children?: ExportedNode[];
};

function exportNode(node: LexicalNode): ExportedNode {
  const json: ExportedNode = { ...$exportNodeJSON(node) };
  if ($isElementNode(node)) {
    json.children = node.getChildren().map(exportNode);
  }
  const slots = $getSlotNames(node);
  if (slots.length > 0) {
    json.$slots = Object.fromEntries(
      slots.map((name) => {
        const slot = $getSlot(node, name);
        if (!slot) throw new Error(`Slot ${name} resolved to no node`);
        return [name, exportNode(slot)];
      }),
    );
  }
  return json;
}

/** The command the web's formatting bar makes each type of list with. */
const LIST_COMMANDS = {
  bullet: INSERT_UNORDERED_LIST_COMMAND,
  number: INSERT_ORDERED_LIST_COMMAND,
  check: INSERT_CHECK_LIST_COMMAND,
};

/**
 * The keyboard event a key press dispatches, as much of it as Lexical's
 * handlers read.
 */
function key(shiftKey = false): KeyboardEvent {
  return {
    preventDefault() {},
    shiftKey,
    target: null,
  } as unknown as KeyboardEvent;
}

function run(
  command: Exclude<Command, { type: "undo" | "redo" | "wait" | "cut" }>,
) {
  const editor = current();
  if (command.type === "setSelection") {
    setSelection(command.anchor, command.focus);
    return;
  }
  if (command.type === "toggleChecked") {
    // What a tap on a checklist item's box does (MobileCheckListPlugin).
    const item = nodeAt(command.path);
    if (!$isListItemNode(item)) {
      throw new EditorError("invalidState", "Not a list item");
    }
    item.toggleChecked();
    return;
  }
  if (command.type === "selectAll") {
    $selectAll(null);
    return;
  }
  const selection = rangeSelection();
  switch (command.type) {
    case "insertText":
    case "commitComposition":
      selection.insertText(command.text);
      return;
    case "deleteCharacter":
      editor.dispatchCommand(
        command.backward ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND,
        key(),
      );
      return;
    case "deleteWord":
      $deleteWord(selection, command.backward);
      return;
    case "deleteLine": {
      const { lineBoundary } = command;
      $deleteLine(selection, command.backward, {
        key: pointNode(lineBoundary).getKey(),
        offset: lineBoundary.offset,
        type: lineBoundary.type,
      });
      return;
    }
    case "insertParagraph":
      // Enter, which a markdown shortcut can take before rich text inserts a
      // paragraph.
      editor.dispatchCommand(KEY_ENTER_COMMAND, null);
      return;
    case "insertLineBreak":
      selection.insertLineBreak(false);
      return;
    case "formatText":
      $formatText(selection, command.format);
      return;
    case "setBlockType":
      $setBlockType(selection, command.blockType);
      return;
    case "insertList":
      editor.dispatchCommand(LIST_COMMANDS[command.listType], undefined);
      return;
    case "removeList":
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    case "indent":
      editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
      return;
    case "outdent":
      editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
      return;
    case "tab":
      editor.dispatchCommand(KEY_TAB_COMMAND, key(command.backward));
      return;
    case "toggleLink":
      $getEditor().dispatchCommand(TOGGLE_LINK_COMMAND, command.url);
      return;
    case "editLink":
      editLink(command.url);
      return;
    case "copy":
      clipboard = copy(selection);
      return;
    case "paste":
      paste(command.clipboard);
      return;
  }
}

/**
 * The link editor's save on the web: the link takes the URL, and an autolink
 * becomes a link, which typing no longer relinks.
 */
function editLink(url: string): void {
  $getEditor().dispatchCommand(TOGGLE_LINK_COMMAND, url);
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const parent = selectedNode(selection).getParent();
  if ($isAutoLinkNode(parent)) {
    parent.replace(
      $createLinkNode(parent.getURL(), {
        rel: parent.__rel,
        target: parent.__target,
        title: parent.__title,
      }),
      true,
    );
  }
}

/** `getSelectedNode` in the web editor's utils. */
function selectedNode(selection: RangeSelection): LexicalNode {
  const { anchor, focus } = selection;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  if (anchorNode === focusNode) return anchorNode;
  return selection.isBackward()
    ? $isAtNodeEnd(focus)
      ? anchorNode
      : focusNode
    : $isAtNodeEnd(anchor)
      ? anchorNode
      : focusNode;
}

/**
 * Places the selection as a user's click or drag does: the points it would
 * resolve to, the format and style Lexical gives a selection made from the
 * DOM, then what a selection change does to them.
 */
function setSelection(anchorAt: PathPoint, focusAt: PathPoint): void {
  const last = $getSelection();
  const selection = $createRangeSelection();
  const { anchor, focus } = selection;
  anchor.set(pointNode(anchorAt).getKey(), anchorAt.offset, anchorAt.type);
  focus.set(pointNode(focusAt).getKey(), focusAt.offset, focusAt.type);
  $normalizeSelectionPointsForBoundaries(anchor, focus);
  selection.format = 0;
  selection.style = "";
  if ($isRangeSelection(last)) {
    const anchorNode = anchor.getNode();
    if (last.anchor.key === anchor.key) {
      selection.format = last.format;
      selection.style = last.style;
    } else if ($isTextNode(anchorNode)) {
      selection.format = anchorNode.getFormat();
      selection.style = anchorNode.getStyle();
    } else if ($isElementNode(anchorNode)) {
      selection.format = anchorNode.getTextFormat();
      selection.style = anchorNode.getTextStyle();
    }
  }
  $setSelection(selection);
  selection.dirty = false;
  if (selection.isCollapsed()) {
    const anchorNode = anchor.getNode();
    if ($isTextNode(anchorNode)) {
      updateFormatStyle(
        selection,
        anchorNode.getFormat(),
        anchorNode.getStyle(),
      );
    } else if (
      $isElementNode(anchorNode) &&
      $getRoot().getTextContent() !== ""
    ) {
      if (anchorNode.isEmpty()) {
        updateFormatStyle(
          selection,
          anchorNode.getTextFormat(),
          anchorNode.getTextStyle(),
        );
      } else {
        updateFormatStyle(selection, selection.format, "");
      }
    }
  } else {
    selection.format = combinedFormat(selection, anchorAt, focusAt);
  }
}

/** `$updateSelectionFormatStyle` from Lexical's selection-change handler. */
function updateFormatStyle(
  selection: RangeSelection,
  format: number,
  style: string,
): void {
  if (selection.format !== format || selection.style !== style) {
    selection.format = format;
    selection.style = style;
    selection.dirty = true;
  }
}

/**
 * The format a selection change gives a range: what its text shares, leaving
 * out text it only touches at an end. The DOM offsets it compares are where
 * the user put the points.
 */
function combinedFormat(
  selection: RangeSelection,
  anchorAt: PathPoint,
  focusAt: PathPoint,
): number {
  const { anchor, focus } = selection;
  const nodes = selection.getNodes();
  const isBackward = selection.isBackward();
  const startOffset = isBackward ? focusAt.offset : anchorAt.offset;
  const endOffset = isBackward ? anchorAt.offset : focusAt.offset;
  const startKey = isBackward ? focus.key : anchor.key;
  const endKey = isBackward ? anchor.key : focus.key;
  let combined = IS_ALL_FORMATTING;
  let hasTextNodes = false;
  for (const [i, node] of nodes.entries()) {
    const size = node.getTextContentSize();
    if (
      $isTextNode(node) &&
      size !== 0 &&
      !(
        (i === 0 && node.__key === startKey && startOffset === size) ||
        (i === nodes.length - 1 && node.__key === endKey && endOffset === 0)
      )
    ) {
      hasTextNodes = true;
      combined &= node.getFormat();
      if (combined === 0) break;
    }
  }
  return hasTextNodes ? combined : 0;
}

/** The node a point names, refused where no selection could be. */
function pointNode(point: PathPoint): LexicalNode {
  const node = nodeAt(point.path);
  const size =
    point.type === "text"
      ? $isTextNode(node)
        ? node.getTextContentSize()
        : -1
      : $isElementNode(node)
        ? node.getChildrenSize()
        : -1;
  if (
    !Number.isInteger(point.offset) ||
    point.offset < 0 ||
    point.offset > size
  ) {
    throw new EditorError(
      "invalidState",
      `No ${point.type} point at ${JSON.stringify(point)}`,
    );
  }
  return node;
}

function nodeAt(path: number[]): LexicalNode {
  let node: LexicalNode = $getRoot();
  for (const index of path) {
    const child: LexicalNode | null = $isElementNode(node)
      ? node.getChildAtIndex(index)
      : null;
    if (!child) {
      throw new EditorError(
        "noNode",
        `No node at path ${JSON.stringify(path)}`,
        path,
      );
    }
    node = child;
  }
  return node;
}

function pathOf(node: LexicalNode): number[] {
  const path: number[] = [];
  for (let parent = node.getParent(); parent; parent = node.getParent()) {
    path.unshift(node.getIndexWithinParent());
    node = parent;
  }
  return path;
}

function pathPoint(point: PointType): PathPoint {
  return {
    path: pathOf(point.getNode()),
    offset: point.offset,
    type: point.type,
  };
}

Object.assign(globalThis, {
  LexicalReference: { load, apply, snapshot, selection, node, childKeys },
});
