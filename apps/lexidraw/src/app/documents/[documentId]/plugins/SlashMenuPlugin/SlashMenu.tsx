import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  BLUR_COMMAND,
  COLLABORATION_TAG,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  type EditorState,
  HISTORIC_TAG,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { type BlockEntry, searchEntries } from "../block-search";
import { SlashMenuList } from "./SlashMenuList";

/**
 * Opens the slash menu at the block `key` names: in it when it is an empty
 * paragraph, else on a new line below. Unhandled when the menu isn't mounted.
 */
export const OPEN_SLASH_MENU_COMMAND = createCommand<NodeKey>(
  "OPEN_SLASH_MENU_COMMAND",
);

/** Where a slash that opens the menu is: its text node and offset in it. */
type Slash = { key: NodeKey; offset: number };
/** The menu while a slash before the caret is open, with what follows it. */
type Open = Slash & { query: string };

const same = (a: Slash | null, b: Slash | null) =>
  a !== null && b !== null && a.key === b.key && a.offset === b.offset;

/** The `/query` the caret is at the end of, when the slash starts a word. */
function matchSlash(text: string): { offset: number; query: string } | null {
  const match = /(^|\s)\/([^\s/][^/\n]{0,39})?$/.exec(text);
  if (!match) return null;
  return {
    offset: match.index + (match[1]?.length ?? 0),
    query: match[2] ?? "",
  };
}

/** Whether the slash at `slash` came in with this update, not before it. */
function typedJustNow(previous: EditorState, slash: Slash, text: string) {
  const before = previous.read(() => $getNodeByKey(slash.key));
  if (!$isTextNode(before)) return true;
  const without = text.slice(0, slash.offset) + text.slice(slash.offset + 1);
  return previous.read(() => before.getTextContent()) === without;
}

/** The slash and query before the caret, if they can open the menu. */
function $slashAtCaret(): (Open & { text: string }) | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const { anchor } = selection;
  if (anchor.type !== "text") return null;
  const node = anchor.getNode();
  if (!node.isSimpleText() || $isCodeNode(node.getParent())) return null;
  const text = node.getTextContent();
  const match = matchSlash(text.slice(0, anchor.offset));
  return match && { key: node.getKey(), ...match, text };
}

/** Takes the `/query` the menu was opened with out of the text. */
function $removeTyped(open: Open) {
  const node = $getNodeByKey(open.key);
  if ($isTextNode(node))
    node.spliceText(open.offset, open.query.length + 1, "", true);
}

/**
 * Runs `entry` in place of the `/query` that found it, as one undo step. A
 * line left empty that the caret has moved out of, as it does when a block
 * is inserted after it, makes way for that block.
 */
function runInstead(editor: LexicalEditor, open: Open, entry?: BlockEntry) {
  if (!entry) return;
  editor.update(() => {
    const line = $getNodeByKey(open.key)?.getParent();
    $removeTyped(open);
    entry.run();
    // Queued, so it follows any update the entry queued in turn.
    editor.update(() => {
      const selection = $getSelection();
      if (
        $isParagraphNode(line) &&
        line.isAttached() &&
        line.getTextContentSize() === 0 &&
        // A table cell or column keeps the one line it must have.
        (line.getPreviousSibling() ?? line.getNextSibling()) !== null &&
        $isRangeSelection(selection) &&
        !$findMatchingParent(selection.anchor.getNode(), (node) =>
          node.is(line),
        )
      )
        line.remove();
    });
  });
}

/**
 * The menu a slash at the start of a word opens: the blocks matching what
 * follows it, picked with the arrows and Enter or the mouse. It opens only
 * as the slash is typed, so a slash already in the text stays text, and
 * Escape leaves what was typed as text.
 */
export function SlashMenu({
  entries,
  onOpen,
}: {
  entries: readonly BlockEntry[];
  /** Called in a read of the editor as the menu opens, the caret at the slash. */
  onOpen?: () => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState<Open | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  // What the update listener last opened, to tell opening from filtering.
  const opened = useRef<Open | null>(null);
  // The slash a menu may open for, set as it is typed, cleared by Escape.
  const armed = useRef<Slash | null>(null);
  // The slash the block handle's + typed, which Escape takes back out.
  const fromButton = useRef<Slash | null>(null);

  const results = open ? searchEntries(entries, open.query) : [];
  const shown = results.length > 0 ? open : null;
  const index = Math.min(highlighted, Math.max(results.length - 1, 0));

  const opening = useEffectEvent(() => onOpen?.());
  // Follows the Lexical editor: the menu opens, filters and closes with its
  // text and caret.
  useEffect(() => {
    const close = () => {
      opened.current = null;
      setOpen(null);
    };
    return mergeRegister(
      editor.registerUpdateListener(
        ({ editorState, prevEditorState, tags }) => {
          if (editor.isComposing()) return;
          editorState.read(() => {
            const slash = $slashAtCaret();
            if (!slash || !editor.isEditable()) {
              armed.current = null;
              return close();
            }
            if (
              slash.query === "" &&
              !tags.has(HISTORIC_TAG) &&
              !tags.has(COLLABORATION_TAG) &&
              typedJustNow(prevEditorState, slash, slash.text)
            )
              armed.current = { key: slash.key, offset: slash.offset };
            if (!same(armed.current, slash)) return close();
            const previous = opened.current;
            if (!previous) opening();
            if (previous?.query !== slash.query) setHighlighted(0);
            opened.current = {
              key: slash.key,
              offset: slash.offset,
              query: slash.query,
            };
            setOpen(opened.current);
          });
        },
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          armed.current = null;
          close();
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        OPEN_SLASH_MENU_COMMAND,
        (key) => {
          const block = $getNodeByKey(key);
          if (!block) return false;
          const line =
            $isParagraphNode(block) && block.getTextContentSize() === 0
              ? block
              : block.insertAfter($createParagraphNode());
          if (!$isParagraphNode(line)) return false;
          const slash = $createTextNode("/");
          line.clear().append(slash);
          slash.select(1, 1);
          fromButton.current = { key: slash.getKey(), offset: 0 };
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  // The keys belong to the menu while it is on screen, and to the editor
  // otherwise.
  useEffect(() => {
    if (!shown) return;
    const key =
      <Payload extends KeyboardEvent | null>(
        handle: (event: Payload) => void,
      ) =>
      (event: Payload) => {
        event?.preventDefault();
        event?.stopImmediatePropagation();
        handle(event);
        return true;
      };
    const move = (by: number) =>
      setHighlighted((index + by + results.length) % results.length);
    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        key(() => move(1)),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        key(() => move(-1)),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        key(() => runInstead(editor, shown, results[index])),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        key(() => runInstead(editor, shown, results[index])),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        key(() => {
          armed.current = null;
          opened.current = null;
          setOpen(null);
          if (same(fromButton.current, shown))
            editor.update(() => $removeTyped(shown));
        }),
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, shown, results, index]);

  if (!shown) return null;
  return (
    <SlashMenuList
      editor={editor}
      at={shown}
      entries={results}
      grouped={shown.query === ""}
      highlighted={index}
      onHighlight={setHighlighted}
      onChoose={(entry) => runInstead(editor, shown, entry)}
    />
  );
}
