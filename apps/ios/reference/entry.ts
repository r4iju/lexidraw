import { registerPlainText } from "@lexical/plain-text";
import { withDOM } from "@lexical/headless/dom";
import { $generateNodesFromDOM } from "@lexical/html";
import { htmlToPlainText, ArticleNode, CalloutNode, LayoutContainerNode, StickyNode, SlideNode, CollapsibleContainerNode, CollapsibleContentNode, CollapsibleTitleNode, CommentNode, ThreadNode } from "@packages/lexical-nodes";
import { $createMarkNode, $unwrapMarkNode, $wrapSelectionInMarkNode, MarkNode } from "@lexical/mark";
import { $dfs, registerNestedElementResolver } from "@lexical/utils";
import { $formatCode } from "@packages/lexical-nodes/code-format";
import CalloutPlugin from "../../lexidraw/src/app/documents/[documentId]/plugins/CalloutPlugin/index.js";
import CollapsiblePlugin from "../../lexidraw/src/app/documents/[documentId]/plugins/CollapsiblePlugin/index.js";
import { LayoutPlugin, UPDATE_LAYOUT_COMMAND } from "../../lexidraw/src/app/documents/[documentId]/plugins/LayoutPlugin/LayoutPlugin.js";
import { withStructuralEditor } from "./structural-hooks.js";
import { withNestedParent } from "./nested-composer-hooks.js";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import KeywordsPlugin from "../../lexidraw/src/app/documents/[documentId]/plugins/KeywordsPlugin/index.js";
import EmojisPlugin from "../../lexidraw/src/app/documents/[documentId]/plugins/EmojisPlugin/index.js";
import { registerLexicalHashtag } from "@lexical/hashtag";
import { editorContexts, editorRegistries } from "./generated-editor-contexts.js";
import { registerTabIndentation } from "@lexical/extension";
let editorContext: keyof typeof editorContexts | "document" = "document";
function hasContextPlugin(plugin: string): boolean {
  return editorContext === "document" || editorContexts[editorContext].includes(plugin);
}
import {
  $setWritingDirection,
  type WritingDirection,
} from "@packages/lexical-nodes/writing-direction";
import {
  $mergeDocumentTableCells,
  $unmergeDocumentTableCell,
  $deleteDocumentTable,
  $toggleDocumentTableRowHeader,
  $toggleDocumentTableColumnHeader,
  $setDocumentTableCellBackground,
  $insertDocumentTableRows,
} from "@packages/lexical-nodes";
/**
 * The editor-model interface over headless Lexical, for ReferenceEditor.swift
 * to call with JSON strings.
 */
import { $exportMimeTypeFromSelection } from "@lexical/clipboard";
import { namedSignals, signal } from "@lexical/extension";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import {
  registerAutoLink,
  registerLink,
  TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import { registerMarkdownShortcuts } from "@lexical/markdown";
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
  saveLink,
  validateUrl,
} from "@packages/lexical-nodes/links";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $isTableCellNode,
  $isTableSelection,
  INSERT_TABLE_COMMAND,
  registerTableCellUnmergeTransform,
  registerTablePlugin,
  TableCellNode,
  type TableSelection,
} from "@lexical/table";
import { SCHEMA_NODES } from "@packages/lexical-nodes/nodes";
import { createTransformers } from "@packages/lexical-nodes/transformers";
import {
  $insertDocumentTableColumns,
  DOCUMENT_TABLE_PLUGIN,
  registerDocumentTableInsertion,
} from "@packages/lexical-nodes/tables";
import {
  $createParagraphNode,
  $createTextNode,
  $insertNodes,
  $createRangeSelection,
  $createNodeSelection,
  $exportNodeJSON,
  $findMatchingParent,
  $formatText,
  $getEditor,
  $getNearestRootOrShadowRoot,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $getSlot,
  $getSiblingCaret,
  $getSlotNames,
  $hasAncestor,
  $isDecoratorNode,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isRootNode,
  $isRootOrShadowRoot,
  $isTextNode,
  $setSelection,
  COMPOSITION_END_TAG,
  type BaseSelection,
  createEditor,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  CUT_TAG,
  DELETE_CHARACTER_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  type ElementFormatType,
  HISTORIC_TAG,
  INDENT_CONTENT_COMMAND,
  INTERNAL_$expandSelectionToWholeDocument,
  IS_ALL_FORMATTING,
  KEY_ENTER_COMMAND,
  type EditorState,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_TAB_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type NodeSelection,
  OUTDENT_CONTENT_COMMAND,
  PASTE_COMMAND,
  type PasteCommandType,
  type PointType,
  REDO_COMMAND,
  type RangeSelection,
  SELECT_ALL_COMMAND,
  type TextFormatType,
  UNDO_COMMAND,
} from "lexical";
import {
  $applyRange,
  $deleteCharacter,
  $deleteLine,
  $deleteWord,
  $normalizeSelectionPointsForBoundaries,
  $shrinkSelectionToRoot,
  $swapPoints,
  type Position,
} from "./deletion.js";
import { EditorError } from "./editor-error.js";
import "./url.js";
import { clearFormatting } from "./clear-formatting.js";
import { nextFontSize, DEFAULT_FONT_SIZE } from "./font-sizing.js";
import { $patchStyleText } from "@lexical/selection";
import {
  $checkSelectionForTable,
  $clearHighlight,
  $cutHandler,
  $deleteCellHandler,
  $deleteTextHandler,
  $fixRangeSelectionForSelectedTable,
  $formatCells,
  $formatCellElements,
  $tabHandler,
  type ArrowKeyEvent,
  registerTableArrowKeys,
  takeTableToCheck,
} from "./tables.js";

type PathPoint = { path: number[]; offset: number; type: "text" | "element" };

/** `LexicalClipboardPayload.mimeType` in EditorModel.swift. */
const LEXICAL_MIME_TYPE = "application/x-lexical-editor";

/** `Clipboard` in EditorModel.swift. */
type Clipboard = {
  "text/plain": string;
  "text/html"?: string;
  [LEXICAL_MIME_TYPE]?: unknown;
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
  | { type: "changeFontSize"; increase: boolean }
  | { type: "clearFormatting" }
  | { type: "formatElement"; format: Exclude<ElementFormatType, ""> }
  | { type: "formatCode" }
  | { type: "setWritingDirection"; direction: WritingDirection }
  | { type: "insertList"; listType: ListType }
  | { type: "removeList" | "indent" | "outdent" }
  | { type: "tab"; backward: boolean }
  | { type: "toggleChecked"; path: number[] }
  | { type: "toggleLink"; url: string | null }
  | { type: "editLink"; url: string }
  | { type: "updateStructuralFields"; path: number[]; node: Record<string, unknown> }
  | { type: "appendComment"; node: Record<string, unknown> }
  | { type: "annotateComment"; id: string }
  | { type: "convertArticle"; path: number[]; text: string }
  | { type: "removeCommentAnnotations"; id: string }
  | { type: "saveCommentThread"; id: string; thread?: Parameters<ThreadNode["setThread"]>[0] }
  | { type: "copy" }
  | { type: "cut" }
  | { type: "paste"; clipboard: Clipboard }
  | { type: "selectAll" }
  | { type: "insertTable"; rows: number; columns: number }
  | { type: "insertTableRow" | "insertTableColumn"; after: boolean }
  | {
      type:
        | "deleteTableRow"
        | "deleteTableColumn"
        | "mergeTableCells"
        | "unmergeTableCell"
        | "deleteTable"
        | "toggleTableRowHeader"
        | "toggleTableColumnHeader";
    }
  | { type: "setTableCellBackground"; color: string }
  | {
      type: "arrow";
      key: "left" | "right" | "up" | "down";
      extend: boolean;
      native: PathPoint;
      atCellEdge: boolean;
      parentRTL?: boolean;
      anchorRTL?: boolean;
    }
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

let parentEditor: LexicalEditor | null = null;
let parentCaptionOwnerKey: string | null = null;

function current(): LexicalEditor {
  if (!editor) throw new EditorError("invalidState", "No document loaded");
  return editor;
}

/**
 * An editor with no root element rather than a headless one, which throws
 * where rich text's arrow keys ask for the root element; without one, an
 * editor updates as a headless one does.
 */
function load(stateJSON: string): void {
  parentEditor = null;
  parentCaptionOwnerKey = null;
  const registry = editorContext === "document" ? null : editorRegistries[editorContext];
  const next = createEditor({
    namespace: EDITOR_NAMESPACE,
    nodes: registry ? SCHEMA_NODES.filter(node => registry.includes(node.getType())) : SCHEMA_NODES,
    onError: (error) => {
      lastError = error;
    },
  });
  configureEditor(next, stateJSON);
}

const mountedRegistrations = new WeakMap<LexicalEditor, (() => void)[]>();

function configureEditor(next: LexicalEditor, stateJSON?: string): void {
  const cleanups: (() => void)[] = [];
  const originalCommand = next.registerCommand.bind(next);
  const originalUpdate = next.registerUpdateListener.bind(next);
  const originalTransform = next.registerNodeTransform.bind(next);
  next.registerCommand = (command, listener, priority) => {
    const cleanup = originalCommand(command, listener, priority);
    cleanups.push(cleanup);
    return cleanup;
  };
  next.registerUpdateListener = listener => {
    const cleanup = originalUpdate(listener);
    cleanups.push(cleanup);
    return cleanup;
  };
  next.registerNodeTransform = (node, listener) => {
    const cleanup = originalTransform(node, listener);
    cleanups.push(cleanup);
    return cleanup;
  };
  const plugins = editorContext === "document" ? null : editorContexts[editorContext];
  withStructuralEditor(next, () => {
    if (!plugins || plugins.includes("LayoutPlugin")) LayoutPlugin();
    if (!plugins || plugins.includes("CollapsiblePlugin")) CollapsiblePlugin();
    if (!plugins || plugins.includes("CalloutPlugin")) CalloutPlugin();
  });
  lastError = null;
  const parsed = stateJSON === undefined ? null : next.parseEditorState(stateJSON);
  // Parsing reports a bad node through onError and returns an empty state.
  if (lastError) throw lastError;
  if (stateJSON !== undefined) now = 0;
  // Registered first, so the loaded document is where undoing stops.
  if (!plugins || plugins.includes("HistoryPlugin")) registerHistory(next, createEmptyHistoryState(), 1000, () => now);
  const registerCommand = next.registerCommand.bind(next);
  next.registerCommand = (command, listener, priority) =>
    registerCommand(
      command,
      (payload, editor) => {
        const keyCommand: unknown = command;
        if (
          keyCommand !== KEY_ARROW_LEFT_COMMAND &&
          keyCommand !== KEY_ARROW_RIGHT_COMMAND
        )
          return listener(payload, editor);
        // These are keyboard events; the adapter adds the measured CSS direction.
        const event = payload as unknown as {
          parentRTL?: boolean;
          anchorRTL?: boolean;
        };
        return withParentDirection(
          editor,
          event.parentRTL ?? false,
          event.anchorRTL ?? event.parentRTL ?? false,
          () => listener(payload, editor),
        );
      },
      priority,
    );
  if (plugins?.includes("PlainTextPlugin")) registerPlainText(next);
  else registerRichText(next);
  next.registerCommand = registerCommand;
  if (!plugins?.includes("PlainTextPlugin")) registerLineMoveOntoBlockDecorators(next);
  // A headless editor refuses root listeners, where an editor without a root
  // element calls them only with none; the checklist's pointer handling
  // registers one, which does nothing without a root.
  next.registerRootListener = () => () => {};
  if (editorContext === "document") registerDocumentEditing(next);
  else if (plugins?.includes("TabIndentationPlugin")) registerTabIndentation(next);
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
  // The document editor's link and table plugins, in the order it mounts them.
  if (editorContext === "document") registerAutoLink(next, {
    changeHandlers: [],
    excludeParents: [],
    matchers: AUTOLINK_MATCHERS,
  });
  if (!plugins || plugins.includes("TablePlugin")) registerTables(next);
  if (!plugins || plugins.includes("LinkPlugin")) registerLink(next, namedSignals({ attributes: undefined, validateUrl }));
  // CommentPlugin flattens directly nested marks and merges their thread IDs.
  if (editorContext === "document") registerNestedElementResolver(next, MarkNode,
    (from) => $createMarkNode(from.getIDs()),
    (from, to) => { for (const id of from.getIDs()) to.addID(id); });
  if (parsed) next.setEditorState(parsed);
  if (editorContext !== "document") {
    for (const plugin of editorContexts[editorContext]) {
      if (plugin === "EmojisPlugin") withStructuralEditor(next, () => { EmojisPlugin(); });
      if (plugin === "HashtagPlugin") registerLexicalHashtag(next);
      if (plugin === "KeywordsPlugin") withStructuralEditor(next, () => { KeywordsPlugin(); });
    }
  }
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
  if (editorContext === "document" || editorContexts[editorContext].includes("MarkdownShortcutPlugin")) registerMarkdownShortcuts(next, createTransformers());
  next.registerCommand = originalCommand;
  next.registerUpdateListener = originalUpdate;
  next.registerNodeTransform = originalTransform;
  mountedRegistrations.set(next, cleanups);
  editor = next;
}

function loadNested(argument: string): void {
  const { state, ownerPath } = JSON.parse(argument) as { state: unknown; ownerPath: number[] };
  const childContext = editorContext;
  if (!["imageCaption", "inlineImageCaption", "videoCaption", "stickyCaption"].includes(childContext)) {
    throw new EditorError("invalidState", "This context has no media caption owner");
  }
  editorContext = "document";
  try {
    load(JSON.stringify(state));
    const parent = current();
    const child = parent.read(() => {
      let node: LexicalNode = $getRoot();
      for (const index of ownerPath) {
        if (!$isElementNode(node)) throw new EditorError("invalidState", "Caption owner path is not an element");
        const found = node.getChildAtIndex(index);
        if (!found) throw new EditorError("invalidState", "Caption owner is missing");
        node = found;
      }
      const captionNode = node as LexicalNode & { __caption?: LexicalEditor };
      const expectedTypes: Record<string, string> = { imageCaption: "image", inlineImageCaption: "inline-image", videoCaption: "video", stickyCaption: "sticky" };
      const expectedType = expectedTypes[childContext];
      if (node.getType() !== expectedType || !captionNode.__caption) {
        throw new EditorError("invalidState", `Caption owner ${node.getType()} (editor=${Boolean(captionNode.__caption)}) does not match ${expectedType}`);
      }
      parentCaptionOwnerKey = node.getKey();
      return captionNode.__caption;
    });
    editorContext = childContext;
    const effects: (() => void)[] = [];
    withNestedParent(parent, () => LexicalNestedComposer({ initialEditor: child, children: null, skipCollabChecks: true }), effects);
    configureEditor(child, JSON.stringify(child.getEditorState().toJSON()));
    mountedRegistrations.get(child)!.push(...effects);
    parentEditor = parent;
  } finally { editorContext = childContext; }
}

function onParent<T>(run: () => T): T {
  if (!parentEditor) throw new EditorError("invalidState", "No parent editor loaded");
  const child = editor;
  const childContext = editorContext;
  editor = parentEditor;
  editorContext = "document";
  try { return run(); }
  finally { editor = child; editorContext = childContext; }
}

function setCaptionVisibility(argument: string): void {
  const show = JSON.parse(argument) as boolean;
  if (typeof show !== "boolean" || !parentCaptionOwnerKey) throw new EditorError("invalidState", "No caption visibility value or owner");
  onParent(() => {
    lastError = null;
    current().update(() => {
      const node = $getNodeByKey(parentCaptionOwnerKey!);
      if (!node || !["image", "inline-image", "video"].includes(node.getType())) {
        throw new EditorError("invalidState", "Caption owner no longer exists");
      }
      (node as LexicalNode & { setShowCaption(show: boolean): void }).setShowCaption(show);
    }, { discrete: true });
    if (lastError) throw lastError;
  });
}

function captionOwnerSnapshot(): string {
  if (!parentEditor || !parentCaptionOwnerKey) throw new EditorError("invalidState", "No caption owner loaded");
  const owned = parentEditor.read(() => {
    const node = $getNodeByKey(parentCaptionOwnerKey!) as (LexicalNode & { __caption?: LexicalEditor }) | null;
    if (!node?.__caption) throw new EditorError("invalidState", "Caption owner no longer exists");
    return node.__caption;
  });
  const mounted = editor;
  editor = owned;
  try { return snapshot(); }
  finally { editor = mounted; }
}

function remountCaption(): void {
  if (!parentEditor || !parentCaptionOwnerKey) throw new EditorError("invalidState", "No caption owner loaded");
  const next = parentEditor.read(() => {
    const owner = $getNodeByKey(parentCaptionOwnerKey!) as (LexicalNode & { __caption?: LexicalEditor }) | null;
    if (!owner?.__caption) throw new EditorError("invalidState", "Caption owner no longer exists");
    return owner.__caption;
  });
  for (const cleanup of mountedRegistrations.get(current()) ?? []) cleanup();
  mountedRegistrations.delete(current());
  const effects: (() => void)[] = [];
  withNestedParent(parentEditor, () => LexicalNestedComposer({ initialEditor: next, children: null, skipCollabChecks: true }), effects);
  configureEditor(next);
  mountedRegistrations.get(next)!.push(...effects);
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
 * A cut: each table's handler takes it where the document has a table, in
 * the one update its command runs in, and rich text's otherwise.
 */
function cut(): void {
  let isCutByATable = false;
  current().update(
    () => {
      isCutByATable = hasContextPlugin("TablePlugin") && $cutHandler((selection) => {
        clipboard = clipboardData(selection);
      });
    },
    { discrete: true },
  );
  if (lastError || isCutByATable) return;
  current().update(
    () => {
      const selection = selectionToCut();
      if ($isRangeSelection(selection) && !selection.isCollapsed()) {
        INTERNAL_$expandSelectionToWholeDocument(selection);
      }
      clipboard = copy(selection);
    },
    { discrete: true, tag: CUT_TAG },
  );
  if (lastError) return;
  current().update(
    () => {
      const selection = selectionToCut();
      if ($isRangeSelection(selection)) selection.removeText();
      else for (const node of selection.getNodes()) node.remove();
    },
    { discrete: true, tag: CUT_TAG },
  );
}

/** What rich text's cut takes: a range, or selected nodes. */
function selectionToCut(): RangeSelection | NodeSelection {
  const selection = $getSelection();
  return $isNodeSelection(selection) ? selection : rangeSelection();
}

/**
 * What a copy puts on the clipboard, which is nothing for a collapsed
 * range.
 */
function copy(selection: BaseSelection): Clipboard | undefined {
  if ($isRangeSelection(selection) && selection.isCollapsed()) return undefined;
  // PlainTextPlugin's copy handler omits Lexical JSON. HTML remains outside
  // this headless clipboard oracle, as in the document copy adapter (#168).
  if (editorContext !== "document" && editorContexts[editorContext].includes("PlainTextPlugin")) {
    return { "text/plain": selection.getTextContent() };
  }
  return clipboardData(selection);
}

/** `$getClipboardDataFromSelection`, short of the HTML (#168). */
function clipboardData(selection: BaseSelection): Clipboard {
  const lexical = $exportMimeTypeFromSelection(LEXICAL_MIME_TYPE, selection);
  return {
    "text/plain": $exportMimeTypeFromSelection("text/plain", selection) ?? "",
    ...(lexical === null
      ? {}
      : { [LEXICAL_MIME_TYPE]: JSON.parse(lexical) as unknown }),
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
  const lexical = pasted[LEXICAL_MIME_TYPE];
  const data: Record<string, string | undefined> = {
    "text/plain": pasted["text/plain"],
    "text/html": pasted["text/html"],
    [LEXICAL_MIME_TYPE]:
      lexical === undefined ? undefined : JSON.stringify(lexical),
  };
  return {
    types: Object.keys(data).filter((type) => data[type] !== undefined),
    files: [],
    // "text" is the DOM's old name for plain text, which the link plugin uses.
    getData: (type: string) => {
      if (
        type === "text/html" &&
        data[type] &&
        data[type] !== data["text/plain"]
      ) {
        throw new EditorError(
          "unsupported",
          "HTML import requires the bun DOM oracle (#168)",
        );
      }
      return data[type === "text" ? "text/plain" : type] ?? "";
    },
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
 * What TablePlugin registers with the web's props, short of what it binds to
 * each table's DOM, which `tables.ts` copies. `hasTabHandler` is read where
 * Tab runs.
 */
function registerTables(next: LexicalEditor): void {
  const { hasCellMerge, hasCellBackgroundColor, hasNestedTables } =
    DOCUMENT_TABLE_PLUGIN;
  registerTablePlugin(next, { hasNestedTables: signal(hasNestedTables) });
  if (!hasCellMerge) registerTableCellUnmergeTransform(next);
  if (!hasCellBackgroundColor) {
    next.registerNodeTransform(TableCellNode, (node) => {
      if (node.getBackgroundColor() !== null) node.setBackgroundColor(null);
    });
  }
  registerTableArrowKeys(next);
  registerDocumentTableInsertion(next);
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

/** The state alone, which reads back where the selection doesn't. */
function serializedState(): string {
  return JSON.stringify(current().getEditorState().toJSON());
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

function elementFormatting(pathJSON: string): string {
  return current().getEditorState().read(() => {
    const node = nodeAt(JSON.parse(pathJSON));
    if (!$isElementNode(node)) throw new EditorError("unsupported", "Not an element");
    return JSON.stringify({ type: node.getType(), direction: node.getDirection(),
      format: node.getFormatType(), indent: node.__indent });
  });
}

function nodePath(key: string): string {
  return current().getEditorState().read(() => {
    const node = $getNodeByKey(key);
    if (!node?.isAttached()) throw new EditorError("invalidState", "The structural block no longer exists");
    return JSON.stringify(pathOf(node));
  });
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
  if ($isTableSelection(selection)) {
    const table = $getNodeByKey(selection.tableKey);
    const anchor = $getNodeByKey(selection.anchor.key);
    const focus = $getNodeByKey(selection.focus.key);
    if (!table || !anchor || !focus) {
      throw new EditorError(
        "invalidState",
        "A table selection's table, anchor cell or focus cell is gone",
      );
    }
    return {
      table: pathOf(table),
      anchor: pathOf(anchor),
      focus: pathOf(focus),
      cells: selectedNodes(selection).filter($isTableCellNode).map(pathOf),
    };
  }
  if ($isNodeSelection(selection)) {
    return { nodes: selection.getNodes().map(pathOf) };
  }
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
 * `TableSelection.getNodes`, which reads `map[row][column]` for each place
 * in the selection's rectangle and fails where the table's map has none, as
 * where a cell spans rows past the table's end.
 */
function selectedNodes(selection: TableSelection): LexicalNode[] {
  try {
    return selection.getNodes();
  } catch (error) {
    // JavaScriptCore's messages for reading a place in a missing row, and
    // for a missing place in a row.
    const isAHole =
      error instanceof TypeError &&
      (/^undefined is not an object \(evaluating '[^']*'\)$/.test(
        error.message,
      ) ||
        error.message ===
          "Cannot destructure property 'cell' from null or undefined value");
    if (isAHole) {
      throw new EditorError(
        "invalidState",
        "TableSelection.getNodes read a cell the table hasn't got",
      );
    }
    throw error;
  }
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
  if (command.type === "convertArticle") {
    return withDOM((window) => {
      let nodes = $generateNodesFromDOM(editor, new window.DOMParser().parseFromString(command.text, "text/html"));
      nodes = nodes.flatMap((node) =>
        CollapsibleContainerNode.$isCollapsibleContainerNode(node) || CollapsibleContentNode.$isCollapsibleContentNode(node) || CollapsibleTitleNode.$isCollapsibleTitleNode(node)
          ? $isElementNode(node) ? node.getChildren() : [] : [node]);
      if (!nodes.length) nodes = [$createParagraphNode().append($createTextNode(htmlToPlainText(command.text)))];
      const node = nodeAt(command.path);
      if (!ArticleNode.$isArticleNode(node)) return;
      let parent = node.getParent();
      while (parent && !CollapsibleContainerNode.$isCollapsibleContainerNode(parent)) parent = parent.getParent();
      (parent ?? node).selectNext();
      $insertNodes(nodes);
      const last = nodes[nodes.length - 1];
      if (last && $isElementNode(last)) last.selectEnd();
      node.remove();
    });
  }
  if (command.type === "updateStructuralFields") {
    const node = nodeAt(command.path), fields = command.node;
    const allowed = node instanceof LayoutContainerNode ? ["templateColumns"] : node instanceof CalloutNode ? ["kind", "title"] : node instanceof CollapsibleContainerNode ? ["open"] : node instanceof StickyNode ? ["color", "xOffset", "yOffset", "caption"] : node instanceof SlideNode ? ["data"] : [];
    if (!Object.keys(fields).length) throw new EditorError("invalidState", "No structural fields");
    if (Object.keys(fields).some(key => !allowed.includes(key))) throw new EditorError("unsupported", "Structural setter belongs to #133");
    if (node instanceof LayoutContainerNode) {
      editor.dispatchCommand(UPDATE_LAYOUT_COMMAND, {nodeKey: node.getKey(), template: fields.templateColumns as string});
    } else if (node instanceof CalloutNode) {
      if ("kind" in fields) node.setKind(fields.kind as Parameters<CalloutNode["setKind"]>[0]);
      if ("title" in fields) node.setTitle(fields.title as string);
    } else if (node instanceof CollapsibleContainerNode) {
      if ("open" in fields) node.setOpen(fields.open as boolean);
    } else if (node instanceof StickyNode) {
      if ("xOffset" in fields || "yOffset" in fields) node.setPosition((fields.xOffset ?? node.__x) as number, (fields.yOffset ?? node.__y) as number);
      if ("caption" in fields) node.setCaptionJSON(fields.caption as Parameters<StickyNode["setCaptionJSON"]>[0]);
      if ("color" in fields) {
        const start = node.getLatest().__color;
        do { node.toggleColor(); } while (node.getLatest().__color !== fields.color && node.getLatest().__color !== start);
        if (node.getLatest().__color !== fields.color) throw new EditorError("invalidState", "Unknown sticky color");
      }
    } else if (node instanceof SlideNode) node.setData(fields.data as Parameters<SlideNode["setData"]>[0]);
    return;
  }
  if (command.type === "removeCommentAnnotations") {
    for (const { node } of $dfs($getRoot())) {
      if (node instanceof MarkNode && node.hasID(command.id)) {
        node.deleteID(command.id);
        if (node.getIDs().length === 0) $unwrapMarkNode(node);
      }
    }
    return;
  }
  if (command.type === "saveCommentThread") {
    for (const { node } of $dfs($getRoot())) {
      if (!command.thread && CommentNode.$isCommentNode(node) && node.__comment.id === command.id) node.remove();
      if (ThreadNode.$isThreadNode(node) && node.getThread().id === command.id) {
        if (command.thread) node.setThread(command.thread); else node.remove();
      }
    }
    return;
  }
  if (command.type === "annotateComment") {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new EditorError("noSelection", "No range selection");
    $wrapSelectionInMarkNode(selection, selection.isBackward(), command.id);
    return;
  }
  if (command.type === "appendComment") {
    if (command.node.type === "comment") $getRoot().append(CommentNode.importJSON(command.node as never));
    else if (command.node.type === "thread") $getRoot().append(ThreadNode.importJSON(command.node as never));
    else throw new EditorError("invalidState", "Not a comment marker");
    return;
  }
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
    current().dispatchCommand(SELECT_ALL_COMMAND, null as never);
    return;
  }
  if (command.type === "arrow") {
    arrow(command);
    return;
  }
  const selection = $getSelection();
  if ($isTableSelection(selection)) {
    runOnCells(command, selection);
    return;
  }
  if ($isNodeSelection(selection)) {
    runOnNodes(command, selection);
    return;
  }
  if (!$isRangeSelection(selection)) {
    throw new EditorError("noSelection", "No range selection");
  }
  switch (command.type) {
    case "insertText":
    case "commitComposition":
      selection.insertText(command.text);
      return;
    case "deleteCharacter": {
      if (hasContextPlugin("TablePlugin") && $deleteCellHandler()) return;
      editor.dispatchCommand(
        command.backward ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND,
        key(),
      );
      return;
    }
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
    case "setWritingDirection":
      $setWritingDirection(command.direction);
      return;
    case "clearFormatting":
      clearFormatting(current());
      return;
    case "changeFontSize":
      $patchStyleText(selection, {
        "font-size": (previous) =>
          `${nextFontSize(Number((previous || `${DEFAULT_FONT_SIZE}px`).slice(0, -2)), command.increase)}px`,
      });
      return;
    case "formatElement":
      current().dispatchCommand(FORMAT_ELEMENT_COMMAND, command.format);
      return;
    case "formatCode":
      $formatCode(selection);
      return;
    case "setBlockType":
      $setBlockType(selection, command.blockType);
      return;
    case "insertList":
    case "removeList":
    case "indent":
    case "outdent":
      runOnBlocks(command);
      return;
    case "tab":
      if (
        hasContextPlugin("TablePlugin") && DOCUMENT_TABLE_PLUGIN.hasTabHandler &&
        $tabHandler(command.backward)
      ) {
        return;
      }
      editor.dispatchCommand(KEY_TAB_COMMAND, key(command.backward));
      return;
    case "toggleLink":
      $getEditor().dispatchCommand(TOGGLE_LINK_COMMAND, command.url);
      return;
    case "editLink":
      saveLink($getEditor(), command.url);
      return;
    case "copy":
      clipboard = copy(selection);
      return;
    case "paste":
      paste(command.clipboard);
      return;
    default:
      runOnTable(command);
  }
}

const ARROW_COMMANDS = {
  down: KEY_ARROW_DOWN_COMMAND,
  left: KEY_ARROW_LEFT_COMMAND,
  right: KEY_ARROW_RIGHT_COMMAND,
  up: KEY_ARROW_UP_COMMAND,
};

/** Supplies computed CSS only while rich text reads it, after table handlers. */
function withParentDirection(
  editor: LexicalEditor,
  rtl: boolean,
  anchorRTL: boolean,
  run: () => boolean,
): boolean {
  if (!rtl && !anchorRTL) return run();
  const selection = $getSelection();
  const node = $isNodeSelection(selection)
    ? selection.getNodes()[0]
    : $isRangeSelection(selection)
      ? selection.anchor.getNode()
      : null;
  const parent = node && ($isRootNode(node) ? node : node.getParent());
  if (!parent) return run();
  const anchorElement = $isElementNode(node) ? node : parent;
  const getElementByKey = editor.getElementByKey;
  // The headless adapter provides just the computed style rich text asks for.
  editor.getElementByKey = (key) =>
    key === parent.getKey() || key === anchorElement.getKey()
      ? ({
          ownerDocument: {
            defaultView: {
              getComputedStyle: () => ({
                direction: (key === anchorElement.getKey() ? anchorRTL : rtl)
                  ? "rtl"
                  : "ltr",
              }),
            },
          },
        } as unknown as HTMLElement)
      : getElementByKey.call(editor, key);
  try {
    return run();
  } finally {
    editor.getElementByKey = getElementByKey;
  }
}

/**
 * An arrow key as a browser has it: the handlers first, and where none
 * takes the key or stops it, the browser's own move; then the selection
 * change that follows either.
 */
function arrow(command: Extract<Command, { type: "arrow" }>): void {
  const before = $getSelection()?.clone() ?? null;
  const event: LineMoveEvent = {
    parentRTL: command.parentRTL ?? false,
    anchorRTL: command.anchorRTL ?? command.parentRTL ?? false,
    atCellEdge: command.atCellEdge,
    native: command.native,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    shiftKey: command.extend,
    stopImmediatePropagation() {},
    stopPropagation() {},
  };
  let handled: boolean;
  try {
    handled = current().dispatchCommand(
      ARROW_COMMANDS[command.key],
      event as unknown as KeyboardEvent,
    );
  } catch (error) {
    if (!(error instanceof Error && error.message === MISSING_WINDOW)) {
      throw error;
    }
    $moveNatively(command);
    handled = true;
  }
  const tableToCheck = takeTableToCheck();
  if (!handled && !event.defaultPrevented) {
    // Rich text turns selected nodes into the range the browser extends,
    // and where it leaves them selected the browser shows no caret to move.
    const extended = $isNodeSelection(before) ? $getSelection() : before;
    if ($isNodeSelection(extended)) return;
    const anchor =
      command.extend && $isRangeSelection(extended)
        ? pathPoint(extended.anchor)
        : command.native;
    setSelection(anchor, command.native);
  } else if (!$reselect(before)) {
    return;
  }
  if (tableToCheck && $checkSelectionForTable(tableToCheck, before)) {
    $reselect(before);
  }
}

/** An arrow key's event, with where the platform's move takes the focus. */
type LineMoveEvent = ArrowKeyEvent & {
  native: PathPoint;
  parentRTL: boolean;
  anchorRTL: boolean;
};

/**
 * The rest of rich text's `$tryDecoratorLineNavigation` for Up and Down,
 * which asks the DOM's selection whether a line move from a block with text
 * leaves it toward a block decorator beside it, and selects the decorator
 * where the move leaves the block or doesn't move. Registered after rich
 * text, so it runs where rich text, with no DOM, gave the key up; the
 * platform's line move is `native`. `$tryInlineGridLineNavigation`, which
 * runs next, finds no inline element the web displays as a grid.
 */
function registerLineMoveOntoBlockDecorators(next: LexicalEditor): void {
  for (const [command, isBackward] of [
    [KEY_ARROW_UP_COMMAND, true],
    [KEY_ARROW_DOWN_COMMAND, false],
  ] as const) {
    next.registerCommand(
      command,
      (keyEvent) => {
        const event = keyEvent as unknown as LineMoveEvent;
        const selection = $getSelection();
        if (event.shiftKey || !$isRangeSelection(selection)) return false;
        if (!selection.isCollapsed()) return false;
        const focus = selection.focus;
        const focusNode = focus.getNode();
        if (focus.type === "element" && $isRootOrShadowRoot(focusNode)) {
          return false;
        }
        const topBlock = $findMatchingParent(
          $isElementNode(focusNode) ? focusNode : focusNode.getParentOrThrow(),
          (node) =>
            $isElementNode(node) &&
            !node.isInline() &&
            $isRootOrShadowRoot(node.getParent()),
        );
        if (topBlock === null) return false;
        const sibling = $getSiblingCaret(
          topBlock,
          isBackward ? "previous" : "next",
        ).getNodeAtCaret();
        if (
          !$isDecoratorNode(sibling) ||
          sibling.isInline() ||
          sibling.isIsolated() ||
          !sibling.isKeyboardSelectable()
        ) {
          return false;
        }
        const moved = pointNode(event.native);
        const at = pathPoint(focus);
        const didNotMove =
          event.native.offset === at.offset &&
          event.native.type === at.type &&
          event.native.path.join() === at.path.join();
        if (
          !didNotMove &&
          (moved.is(topBlock) || $hasAncestor(moved, topBlock))
        ) {
          return false;
        }
        const nodeSelection = $createNodeSelection();
        nodeSelection.add(sibling.getKey());
        $setSelection(nodeSelection);
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_EDITOR,
    );
  }
}

/**
 * What `RangeSelection.modify` throws on reaching for the browser's
 * selection, which an editor with no root element has none of.
 */
const MISSING_WINDOW = "window object not found";

/**
 * The rest of `RangeSelection.modify` after the browser's selection moves
 * its focus to `native`: that selection read back, and when extending,
 * kept to the anchor's root and pointed the way the browser's points.
 */
function $moveNatively(command: Extract<Command, { type: "arrow" }>): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const native: Position = {
    key: pointNode(command.native).getKey(),
    offset: command.native.offset,
    type: command.native.type,
  };
  if (!command.extend) {
    $applyRange(selection, native, native);
    selection.dirty = true;
    return;
  }
  const anchorNode = selection.anchor.getNode();
  const root = $isRootNode(anchorNode)
    ? anchorNode
    : $getNearestRootOrShadowRoot(anchorNode);
  const moved = selection.clone();
  moved.focus.set(native.key, native.offset, native.type);
  const anchorIsAtStart = !moved.isBackward();
  const { key, offset, type } = selection.anchor;
  const anchor: Position = { key, offset, type };
  if (anchorIsAtStart) $applyRange(selection, anchor, native);
  else $applyRange(selection, native, anchor);
  selection.dirty = true;
  const rtl = command.anchorRTL ?? command.parentRTL ?? false;
  const backward =
    command.key === "left"
      ? !rtl
      : command.key === "right"
        ? rtl
        : command.key === "up";
  $shrinkSelectionToRoot(selection, backward, root);
  if (!anchorIsAtStart) $swapPoints(selection);
}

/**
 * The selection change a browser has after Lexical moves a range: the
 * DOM's selection read back, as `setSelection` reads a user's. Lexical
 * skips one inside text at both ends as its own. False where there was
 * none.
 */
function $reselect(before: BaseSelection | null): boolean {
  const selection = $getSelection();
  const inText = (point: PointType) =>
    point.type === "text" &&
    point.offset !== 0 &&
    point.offset !== point.getNode().getTextContentSize();
  if (
    !$isRangeSelection(selection) ||
    ($isRangeSelection(before) &&
      before.anchor.is(selection.anchor) &&
      before.focus.is(selection.focus)) ||
    (inText(selection.anchor) && inText(selection.focus))
  ) {
    return false;
  }
  setSelection(pathPoint(selection.anchor), pathPoint(selection.focus));
  return true;
}

/** A table selection, where each table's handlers answer first. */
function runOnCells(
  command: Exclude<
    Command,
    {
      type:
        | "setSelection"
        | "toggleChecked"
        | "selectAll"
        | "arrow"
        | "undo"
        | "redo"
        | "wait"
        | "cut"
        | "updateStructuralFields"
        | "appendComment"
        | "annotateComment"
        | "saveCommentThread"
        | "removeCommentAnnotations"
        | "convertArticle";
    }
  >,
  selection: TableSelection,
) {
  switch (command.type) {
    case "insertText":
    case "commitComposition":
      $clearHighlight();
      return;
    case "deleteCharacter":
      $deleteCellHandler();
      return;
    case "deleteWord":
    case "deleteLine":
      $deleteTextHandler();
      return;
    case "formatText":
      $formatCells(selection, command.format);
      return;
    case "setWritingDirection":
      $setWritingDirection(command.direction);
      return;
    case "clearFormatting":
      clearFormatting(current());
      return;
    case "changeFontSize":
      $patchStyleText(selection, {
        "font-size": (previous) =>
          `${nextFontSize(Number((previous || `${DEFAULT_FONT_SIZE}px`).slice(0, -2)), command.increase)}px`,
      });
      return;
    case "formatElement":
      $formatCellElements(selection, command.format);
      return;
    case "formatCode":
      $formatCode(selection);
      return;
    case "setBlockType":
      $setBlockType(selection, command.blockType);
      return;
    case "insertParagraph":
    case "insertLineBreak":
      // Rich text's Enter answers a range selection alone.
      return;
    case "tab":
      current().dispatchCommand(KEY_TAB_COMMAND, key(command.backward));
      return;
    case "insertList":
    case "removeList":
    case "indent":
    case "outdent":
      runOnBlocks(command);
      return;
    case "toggleLink":
      current().dispatchCommand(TOGGLE_LINK_COMMAND, command.url);
      return;
    case "editLink":
      saveLink(current(), command.url);
      return;
    case "copy":
      clipboard = copy(selection);
      return;
    case "paste":
      paste(command.clipboard);
      return;
    default:
      runOnTable(command);
  }
}

/**
 * A selected node, as a rule is where an arrow or a deletion reaches it,
 * which rich text's handlers answer as the web's keys and menus send them.
 */
function runOnNodes(
  command: Exclude<
    Command,
    {
      type:
        | "setSelection"
        | "toggleChecked"
        | "selectAll"
        | "arrow"
        | "undo"
        | "redo"
        | "wait"
        | "cut"
        | "updateStructuralFields"
        | "appendComment"
        | "annotateComment"
        | "saveCommentThread"
        | "removeCommentAnnotations"
        | "convertArticle";
    }
  >,
  selection: NodeSelection,
) {
  const editor = current();
  switch (command.type) {
    case "insertText":
    case "commitComposition":
      selection.insertText();
      return;
    case "deleteCharacter":
      editor.dispatchCommand(
        command.backward ? KEY_BACKSPACE_COMMAND : KEY_DELETE_COMMAND,
        key(),
      );
      return;
    case "deleteWord":
    case "deleteLine":
      // Rich text deletes a word or a line from a range selection alone.
      return;
    case "insertParagraph":
      editor.dispatchCommand(KEY_ENTER_COMMAND, null);
      return;
    case "insertLineBreak":
      editor.dispatchCommand(KEY_ENTER_COMMAND, key(true));
      return;
    case "formatText":
      $formatText(selection, command.format);
      return;
    case "setWritingDirection":
      $setWritingDirection(command.direction);
      return;
    case "clearFormatting":
      clearFormatting(current());
      return;
    case "changeFontSize":
      $patchStyleText(selection, {
        "font-size": (previous) =>
          `${nextFontSize(Number((previous || `${DEFAULT_FONT_SIZE}px`).slice(0, -2)), command.increase)}px`,
      });
      return;
    case "formatElement":
      current().dispatchCommand(FORMAT_ELEMENT_COMMAND, command.format);
      return;
    case "formatCode":
      $formatCode(selection);
      return;
    case "setBlockType":
      $setBlockType(selection, command.blockType);
      return;
    case "tab":
      editor.dispatchCommand(KEY_TAB_COMMAND, key(command.backward));
      return;
    case "insertList":
    case "removeList":
    case "indent":
    case "outdent":
      runOnBlocks(command);
      return;
    case "toggleLink":
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, command.url);
      return;
    case "editLink":
      saveLink(editor, command.url);
      return;
    case "copy":
      clipboard = copy(selection);
      return;
    case "paste":
      paste(command.clipboard);
      return;
    default:
      runOnTable(command);
  }
}

/** The toolbar's list, indent and outdent buttons. */
function runOnBlocks(
  command: Extract<
    Command,
    { type: "insertList" | "removeList" | "indent" | "outdent" }
  >,
) {
  const editor = current();
  switch (command.type) {
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
  }
}

/** The insert-table dialog and the table menu. */
function runOnTable(
  command: Extract<
    Command,
    {
      type:
        | "insertTable"
        | "insertTableRow"
        | "insertTableColumn"
        | "deleteTableRow"
        | "deleteTableColumn"
        | "mergeTableCells"
        | "unmergeTableCell"
        | "deleteTable"
        | "toggleTableRowHeader"
        | "toggleTableColumnHeader"
        | "setTableCellBackground";
    }
  >,
) {
  switch (command.type) {
    case "mergeTableCells":
      $mergeDocumentTableCells();
      return;
    case "unmergeTableCell":
      $unmergeDocumentTableCell();
      return;
    case "deleteTable":
      $deleteDocumentTable();
      return;
    case "toggleTableRowHeader":
      $toggleDocumentTableRowHeader();
      return;
    case "toggleTableColumnHeader":
      $toggleDocumentTableColumnHeader();
      return;
    case "setTableCellBackground":
      $setDocumentTableCellBackground(command.color);
      return;
    case "insertTable":
      current().dispatchCommand(INSERT_TABLE_COMMAND, {
        rows: String(command.rows),
        columns: String(command.columns),
      });
      return;
    case "insertTableRow":
      $insertDocumentTableRows(command.after);
      return;
    case "insertTableColumn":
      $insertDocumentTableColumns(command.after);
      return;
    case "deleteTableRow":
      $deleteTableRowAtSelection();
      return;
    case "deleteTableColumn":
      $deleteTableColumnAtSelection();
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
  if (hasContextPlugin("TablePlugin")) $fixRangeSelectionForSelectedTable(selection);
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
  LexicalReference: {
    setContext: (context: typeof editorContext) => { editorContext = context; },
    load,
    loadNested,
    parentSnapshot: () => onParent(snapshot),
    captionOwnerSnapshot,
    remountCaption,
    setCaptionVisibility,
    applyToParent: (command: string) => onParent(() => apply(command)),
    apply,
    snapshot,
    serializedState,
    selection,
    node,
    childKeys,
    elementFormatting,
    nodePath,
  },
});
