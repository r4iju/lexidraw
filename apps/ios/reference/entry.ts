/**
 * The editor-model interface over headless Lexical, for ReferenceEditor.swift
 * to call with JSON strings.
 */
import { createHeadlessEditor } from "@lexical/headless";
import { CORE_NODES } from "@packages/lexical-nodes/nodes";
import {
  $createRangeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
} from "lexical";

type PathPoint = { path: number[]; offset: number; type: "text" | "element" };

type Command =
  | { type: "setSelection"; anchor: PathPoint; focus: PathPoint }
  | { type: "insertText"; text: string };

let editor: LexicalEditor | null = null;
let lastError: unknown = null;
let changed: number[][] = [];

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
  next.registerUpdateListener(({ dirtyElements, dirtyLeaves, editorState }) => {
    const keys = [...dirtyLeaves];
    for (const [key, intentional] of dirtyElements) {
      if (intentional) keys.push(key);
    }
    changed = editorState.read(() =>
      keys.flatMap((key) => {
        const node = $getNodeByKey(key);
        return node ? [pathOf(node)] : [];
      }),
    );
  });
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

function setSelection(anchor: PathPoint, focus: PathPoint): void {
  const selection = $createRangeSelection();
  selection.anchor.set(
    nodeAt(anchor.path).getKey(),
    anchor.offset,
    anchor.type,
  );
  selection.focus.set(nodeAt(focus.path).getKey(), focus.offset, focus.type);
  const node = selection.anchor.getNode();
  if (!selection.isCollapsed() || !$isTextNode(node)) {
    throw new Error("Only a caret in text is ported to the reference so far");
  }
  selection.format = node.getFormat();
  selection.style = node.getStyle();
  $setSelection(selection);
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
  LexicalReference: { load, apply, snapshot },
});
