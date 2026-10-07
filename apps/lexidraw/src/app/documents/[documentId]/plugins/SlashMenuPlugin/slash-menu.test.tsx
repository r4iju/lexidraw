/// <reference types="bun" />
import { installDom, render } from "~/test/dom";
installDom();
import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  type LexicalCommand,
} from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { BlockEntry } from "../block-search";
import { OPEN_SLASH_MENU_COMMAND, SlashMenu } from "./SlashMenu";

// jsdom has no layout; the menu only needs a rectangle to place itself by.
const ranges = window.Range.prototype as unknown as Record<string, unknown>;
ranges.getBoundingClientRect ??= () => new window.DOMRect(0, 0, 0, 0);
ranges.getClientRects ??= () => [];
// Without an event in flight Lexical rereads the selection from the DOM, which
// jsdom never moves; any other event keeps the selection Lexical holds.
Object.defineProperty(window, "event", {
  value: { type: "test" },
  configurable: true,
});

const ran: string[] = [];
const entry = (
  id: string,
  label: string,
  keywords: string[] = [],
): BlockEntry => ({
  id,
  label,
  group: "Basic",
  keywords,
  icon: null,
  run: () => ran.push(id),
});
/** Inserts a block after the caret's and moves the caret into it, as inserts do. */
const insertAfter: BlockEntry = {
  ...entry("callout", "Callout"),
  run: () => {
    ran.push("callout");
    const block = $getSelection()?.getNodes()[0]?.getTopLevelElement();
    const inserted = $createParagraphNode().append($createTextNode("Inserted"));
    block?.insertAfter(inserted);
    inserted.selectEnd();
  },
};
const ENTRIES = [
  entry("h1", "Heading 1", ["h1", "title"]),
  entry("h2", "Heading 2", ["h2"]),
  entry("toggle-h1", "Toggle heading 1"),
  entry("divider", "Divider", ["hr", "line"]),
  entry("table", "Table"),
  insertAfter,
];

let editor: LexicalEditor;
function Capture() {
  [editor] = useLexicalComposerContext();
  return null;
}

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  ran.length = 0;
});

/** An editor holding `lines` as paragraphs, the caret at the end of the last. */
async function setup(lines: string[] = [""]) {
  ({ unmount } = await render(
    <LexicalComposer
      initialConfig={{
        namespace: "slash-menu-test",
        onError(error) {
          throw error;
        },
        editorState() {
          for (const line of lines) {
            const paragraph = $createParagraphNode();
            if (line) paragraph.append($createTextNode(line));
            $getRoot().append(paragraph);
          }
          $getRoot().getLastChildOrThrow().selectEnd();
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <SlashMenu entries={ENTRIES} />
      <Capture />
    </LexicalComposer>,
  ));
}

/** Types `text` one character at a time, as a keyboard would. */
async function type(text: string) {
  for (const character of text)
    await act(async () => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(character);
      });
    });
}

async function press<Event extends KeyboardEvent | null>(
  command: LexicalCommand<Event>,
) {
  const event = new window.KeyboardEvent("keydown");
  await act(async () => {
    // Every key command takes the keydown; some also take null.
    editor.dispatchCommand(command, event as Event);
  });
}

const options = () =>
  [...document.querySelectorAll('[role="option"]')].map(
    (option) => option.textContent,
  );
const text = () =>
  editor.getEditorState().read(() => $getRoot().getTextContent());

test("typing / on an empty line lists every block", async () => {
  await setup();
  await type("/");
  expect(options()).toEqual([
    "Heading 1",
    "Heading 2",
    "Toggle heading 1",
    "Divider",
    "Table",
    "Callout",
  ]);
});

test("the query filters and ranks what is listed", async () => {
  await setup();
  await type("/hea");
  expect(options()).toEqual(["Heading 1", "Heading 2", "Toggle heading 1"]);
});

test("a keyword or a loose spelling finds a block", async () => {
  await setup();
  await type("/hr");
  expect(options()).toEqual(["Divider"]);
  await press(KEY_ESCAPE_COMMAND);
  await type(" /dvdr");
  expect(options()).toEqual(["Divider"]);
});

test("Enter runs the highlighted block in place of what was typed", async () => {
  await setup(["Some words"]);
  await type(" /hea");
  await press(KEY_ARROW_DOWN_COMMAND);
  await press(KEY_ENTER_COMMAND);
  expect(ran).toEqual(["h2"]);
  expect(text()).toBe("Some words ");
  expect(options()).toEqual([]);
});

const blocks = () =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((block) => block.getTextContent()),
  );

test("a block inserted from an otherwise empty line takes the line's place", async () => {
  await setup(["First", ""]);
  await type("/call");
  await press(KEY_ENTER_COMMAND);
  expect(ran).toEqual(["callout"]);
  expect(blocks()).toEqual(["First", "Inserted"]);
});

test("a block inserted from a line with text keeps the line", async () => {
  await setup(["First"]);
  await type(" /call");
  await press(KEY_ENTER_COMMAND);
  expect(blocks()).toEqual(["First ", "Inserted"]);
});

test("a query matching nothing closes the menu and leaves the keys to the editor", async () => {
  await setup();
  await type("/zzz");
  expect(options()).toEqual([]);
  const reached: string[] = [];
  const record = (name: string) => () => {
    reached.push(name);
    return false;
  };
  editor.registerCommand(
    KEY_ESCAPE_COMMAND,
    record("Escape"),
    COMMAND_PRIORITY_LOW,
  );
  editor.registerCommand(
    KEY_ENTER_COMMAND,
    record("Enter"),
    COMMAND_PRIORITY_LOW,
  );
  await press(KEY_ESCAPE_COMMAND);
  await press(KEY_ENTER_COMMAND);
  expect(reached).toEqual(["Escape", "Enter"]);
});

test("after Escape the slash is plain text and typing on keeps it closed", async () => {
  await setup();
  await type("/");
  await press(KEY_ESCAPE_COMMAND);
  expect(options()).toEqual([]);
  await type("ta");
  expect(options()).toEqual([]);
  expect(text()).toBe("/ta");
  await type(" /ta");
  expect(options()).toEqual(["Table"]);
});

test("a slash right after a word is just a slash", async () => {
  await setup();
  await type("and/");
  expect(options()).toEqual([]);
});

test("a slash already in the text does not open the menu when the caret returns to it", async () => {
  await setup(["see /table"]);
  await act(async () => {
    editor.update(() => $getRoot().getFirstChildOrThrow().selectStart());
  });
  await act(async () => {
    editor.update(() => $getRoot().getFirstChildOrThrow().selectEnd());
  });
  expect(options()).toEqual([]);
});

test("the block menu's + opens the menu on a new line below, and Escape takes the slash back", async () => {
  await setup(["First"]);
  const key = editor
    .getEditorState()
    .read(() => $getRoot().getFirstChildOrThrow().getKey());
  await act(async () => {
    editor.dispatchCommand(OPEN_SLASH_MENU_COMMAND, key);
  });
  expect(options()).toHaveLength(ENTRIES.length);
  await press(KEY_ESCAPE_COMMAND);
  expect(options()).toEqual([]);
  expect(
    editor.getEditorState().read(() =>
      $getRoot()
        .getChildren()
        .map((block) => block.getTextContent()),
    ),
  ).toEqual(["First", ""]);
});

test("the + on an empty line opens the menu in that line", async () => {
  await setup(["First", ""]);
  const key = editor
    .getEditorState()
    .read(() => $getRoot().getLastChildOrThrow().getKey());
  await act(async () => {
    editor.dispatchCommand(OPEN_SLASH_MENU_COMMAND, key);
  });
  expect(options()).toHaveLength(ENTRIES.length);
  expect(
    editor.getEditorState().read(() => $getRoot().getChildren().length),
  ).toBe(2);
});
