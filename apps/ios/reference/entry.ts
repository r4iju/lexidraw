/**
 * The JS reference editor: headless Lexical with the web editor's core node
 * registry, driven through the same editor-model interface LexicalSwift
 * implements. Swift loads this bundle into JavaScriptCore and exchanges JSON
 * strings with it.
 */
import { createHeadlessEditor } from "@lexical/headless";
import { CORE_NODES } from "@packages/lexical-nodes/nodes";
import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  type RangeSelection,
} from "lexical";

type PathPoint = { path: number[]; offset: number; type: "text" | "element" };

type Command =
  | { type: "setSelection"; anchor: PathPoint; focus: PathPoint }
  | { type: "insertText"; text: string };

let editor: LexicalEditor | null = null;
let lastError: unknown = null;
let changed: string[] = [];

function current(): LexicalEditor {
  if (!editor) throw new Error("No document loaded");
  return editor;
}

function load(stateJSON: string): void {
  const next = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      lastError = error;
    },
  });
  lastError = null;
  const parsed = next.parseEditorState(stateJSON);
  // Parsing reports a bad node through onError and returns an empty state.
  if (lastError) throw lastError;
  next.setEditorState(parsed);
  next.registerUpdateListener(
    ({ dirtyElements, dirtyLeaves, prevEditorState, editorState }) => {
      const keys = new Set(dirtyLeaves);
      for (const [key, intentional] of dirtyElements) {
        if (intentional) keys.add(key);
      }
      for (const key of prevEditorState._nodeMap.keys()) {
        if (!editorState._nodeMap.has(key)) keys.add(key);
      }
      changed = [...keys];
    },
  );
  editor = next;
}

function apply(commandJSON: string): string {
  const command = JSON.parse(commandJSON) as Command;
  lastError = null;
  changed = [];
  current().update(() => run(command), { discrete: true });
  if (lastError) throw lastError;
  return JSON.stringify({ changed });
}

function snapshot(): string {
  const state = current().getEditorState();
  return state.read(() => {
    const selection = $getSelection();
    return JSON.stringify({
      state: state.toJSON(),
      selection: $isRangeSelection(selection)
        ? {
            anchor: pathPoint(selection.anchor),
            focus: pathPoint(selection.focus),
            format: selection.format,
            style: selection.style,
          }
        : null,
    });
  });
}

function run(command: Command): void {
  switch (command.type) {
    case "setSelection":
      setSelection(command.anchor, command.focus);
      return;
    case "insertText": {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("No range selection");
      selection.insertText(command.text);
      return;
    }
  }
}

/**
 * Places the selection the way a user does, so the selection format and
 * style follow Lexical's own selection-change handling: a new selection
 * carries the previous one's format and style, then takes them from what it
 * lands in.
 */
function setSelection(anchor: PathPoint, focus: PathPoint): void {
  const previous = $getSelection();
  const selection = $createRangeSelection();
  if ($isRangeSelection(previous)) {
    selection.format = previous.format;
    selection.style = previous.style;
  }
  selection.anchor.set(
    nodeAt(anchor.path).getKey(),
    anchor.offset,
    anchor.type,
  );
  selection.focus.set(nodeAt(focus.path).getKey(), focus.offset, focus.type);
  $setSelection(selection);
  if (selection.isCollapsed()) {
    takeCollapsedFormat(selection);
  } else {
    selection.format = combinedFormat(selection);
  }
}

function takeCollapsedFormat(selection: RangeSelection): void {
  const node = selection.anchor.getNode();
  if ($isTextNode(node)) {
    selection.format = node.getFormat();
    selection.style = node.getStyle();
  } else if ($isElementNode(node) && $getRoot().getTextContent() !== "") {
    if (node.isEmpty()) {
      selection.format = node.getTextFormat();
      selection.style = node.getTextStyle();
    } else {
      selection.style = "";
    }
  }
}

function combinedFormat(selection: RangeSelection): number {
  const nodes = selection.getNodes();
  const [start, end] = selection.isBackward()
    ? [selection.focus, selection.anchor]
    : [selection.anchor, selection.focus];
  let format = -1;
  let hasText = false;
  nodes.forEach((node, i) => {
    if (!$isTextNode(node)) return;
    const size = node.getTextContentSize();
    const emptyAtStart =
      i === 0 && node.getKey() === start.key && start.offset === size;
    const emptyAtEnd =
      i === nodes.length - 1 && node.getKey() === end.key && end.offset === 0;
    if (size === 0 || emptyAtStart || emptyAtEnd) return;
    hasText = true;
    format &= node.getFormat();
  });
  return hasText ? format : 0;
}

function nodeAt(path: number[]): LexicalNode {
  let node: LexicalNode = $getRoot();
  for (const index of path) {
    const child: LexicalNode | null = $isElementNode(node)
      ? node.getChildAtIndex(index)
      : null;
    if (!child) throw new Error(`No node at path ${JSON.stringify(path)}`);
    node = child;
  }
  return node;
}

function pathPoint(point: PointType): PathPoint {
  const path: number[] = [];
  let node: LexicalNode = point.getNode();
  for (let parent = node.getParent(); parent; parent = node.getParent()) {
    path.unshift(node.getIndexWithinParent());
    node = parent;
  }
  return { path, offset: point.offset, type: point.type };
}

Object.assign(globalThis, {
  LexicalReference: { load, apply, snapshot },
});
