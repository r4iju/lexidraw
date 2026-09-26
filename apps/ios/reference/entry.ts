/**
 * The editor-model interface over headless Lexical, for ReferenceEditor.swift
 * to call with JSON strings.
 */
import { createHeadlessEditor } from "@lexical/headless";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { SCHEMA_NODES } from "@packages/lexical-nodes/nodes";
import {
  $createRangeSelection,
  $exportNodeJSON,
  $formatText,
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
  HISTORIC_TAG,
  IS_ALL_FORMATTING,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
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

type Command =
  | { type: "setSelection"; anchor: PathPoint; focus: PathPoint }
  | { type: "insertText"; text: string }
  | { type: "deleteCharacter" | "deleteWord"; backward: boolean }
  | { type: "deleteLine"; backward: boolean; lineBoundary: PathPoint }
  | { type: "insertParagraph" }
  | { type: "insertLineBreak" }
  | { type: "formatText"; format: TextFormatType }
  | { type: "selectAll" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "wait"; milliseconds: number };

let editor: LexicalEditor | null = null;
let lastError: unknown = null;
let changed: number[][] = [];
/** The clock history reads, which only `wait` moves. */
let now = 0;

function current(): LexicalEditor {
  if (!editor) throw new EditorError("invalidState", "No document loaded");
  return editor;
}

function load(stateJSON: string): void {
  const next = createHeadlessEditor({
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
      changed = editorState.read(() =>
        keys.flatMap((key) => {
          const node = $getNodeByKey(key);
          return node ? [pathOf(node)] : [];
        }),
      );
    },
  );
  editor = next;
}

function apply(commandJSON: string): string {
  const command = JSON.parse(commandJSON) as Command;
  lastError = null;
  changed = [];
  switch (command.type) {
    case "undo":
    case "redo":
      current().dispatchCommand(
        command.type === "undo" ? UNDO_COMMAND : REDO_COMMAND,
        undefined,
      );
      // History commits the state it restores in a microtask, before anything
      // else a user could do; reading commits it now.
      current().read(() => {});
      break;
    case "wait":
      now += command.milliseconds;
      break;
    default:
      current().update(() => run(command), { discrete: true });
  }
  if (lastError) throw lastError;
  return JSON.stringify({ changed });
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

function run(command: Exclude<Command, { type: "undo" | "redo" | "wait" }>) {
  if (command.type === "setSelection") {
    setSelection(command.anchor, command.focus);
    return;
  }
  if (command.type === "selectAll") {
    $selectAll(null);
    return;
  }
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    throw new EditorError("noSelection", "No range selection");
  }
  switch (command.type) {
    case "insertText":
      selection.insertText(command.text);
      return;
    case "deleteCharacter":
      $deleteCharacter(selection, command.backward);
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
      selection.insertParagraph();
      return;
    case "insertLineBreak":
      selection.insertLineBreak(false);
      return;
    case "formatText":
      $formatText(selection, command.format);
      return;
  }
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
