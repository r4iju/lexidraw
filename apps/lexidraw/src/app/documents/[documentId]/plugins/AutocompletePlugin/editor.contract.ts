import { expect, test } from "bun:test";
import { installDom } from "~/test/dom";
installDom();
window.Range.prototype.getBoundingClientRect = () =>
  new window.DOMRect(0, 0, 0, 0);
const {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  KEY_TAB_COMMAND,
} = await import("lexical");
const { registerAutocomplete } = await import("./register");
const pause = () => new Promise((r) => setTimeout(r, 30));

test("actual Lexical suggestions preserve explicit acceptance and supersession", async () => {
  const editor = createEditor({
    namespace: "autocomplete-test",
    onError: (e) => {
      throw e;
    },
  });
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  root.tabIndex = 0;
  document.body.append(root);
  editor.setRootElement(root);
  root.focus();
  const pending: { signal: AbortSignal; reply: (text: string) => void }[] = [];
  let stop = registerAutocomplete(editor, {
    title: "",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: (_input, signal) =>
      new Promise((reply) => pending.push({ signal, reply })),
  });
  editor.update(
    () => {
      const text = $createTextNode("Hello");
      $getRoot().append($createParagraphNode().append(text));
      text.selectEnd();
    },
    { discrete: true },
  );
  await pause();
  expect(pending).toHaveLength(1);
  editor.update(
    () => {
      $getSelection()?.insertText(" world");
    },
    { discrete: true },
  );
  await pause();
  expect(pending[0]?.signal.aborted).toBe(true);
  expect(pending).toHaveLength(1);
  pending[0]?.reply(" stale");
  await pause();
  expect(root.textContent).toBe("Hello world");
  expect(root.querySelector("[data-suggestion]")).toBeNull();
  expect(pending).toHaveLength(2);
  pending[1]?.reply(" today.");
  await pause();
  expect(root.textContent).toBe("Hello world");
  expect(
    root.querySelector("[data-suggestion]")?.getAttribute("data-suggestion"),
  ).toBe(" today.");
  editor.dispatchCommand(
    KEY_TAB_COMMAND,
    new window.KeyboardEvent("keydown", { key: "Tab" }),
  );
  await pause();
  expect(root.textContent).toBe("Hello world today.");
  expect(pending).toHaveLength(3);
  stop();
  stop = registerAutocomplete(editor, {
    title: "Changed source",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: (_input, signal) =>
      new Promise((reply) => pending.push({ signal, reply })),
  });
  editor.update(
    () => {
      $getSelection()?.insertText(" Again");
    },
    { discrete: true },
  );
  await pause();
  expect(pending).toHaveLength(3);
  pending[2]?.reply(" old source");
  await pause();
  expect(pending).toHaveLength(4);
  expect(root.querySelector("[data-suggestion]")).toBeNull();
  stop();
  pending[3]?.reply(" discarded");
  await pause();
  editor.setRootElement(null);
  root.remove();
});

test("source changes retain the editor request rate limit", async () => {
  const editor = createEditor({
    namespace: "rate",
    onError: (e) => {
      throw e;
    },
  });
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  root.tabIndex = 0;
  document.body.append(root);
  editor.setRootElement(root);
  root.focus();
  let calls = 0;
  const options = {
    title: "",
    delayMs: 0,
    minIntervalMs: 200,
    suggest: async () => {
      calls++;
      return "";
    },
  };
  let stop = registerAutocomplete(editor, options);
  editor.update(
    () => {
      const text = $createTextNode("Hello");
      $getRoot().append($createParagraphNode().append(text));
      text.selectEnd();
    },
    { discrete: true },
  );
  await pause();
  expect(calls).toBe(1);
  stop();
  stop = registerAutocomplete(editor, options);
  editor.update(
    () => {
      $getSelection()?.insertText(" again");
    },
    { discrete: true },
  );
  await pause();
  expect(calls).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(calls).toBe(2);
  stop();
  editor.setRootElement(null);
  root.remove();
});

test("marked composition, deletion and undo preserve actual editor text and selection", async () => {
  const { registerHistory, createEmptyHistoryState } = await import(
    Bun.resolveSync(
      "@lexical/history",
      new URL("..", import.meta.resolve("@lexical/react/LexicalHistoryPlugin"))
        .pathname,
    )
  );
  const { UNDO_COMMAND, $isRangeSelection, $setCompositionKey, $isTextNode } =
    await import("lexical");
  const editor = createEditor({
    namespace: "composition",
    onError: (e) => {
      throw e;
    },
  });
  const root = document.createElement("div");
  root.setAttribute("contenteditable", "true");
  root.tabIndex = 0;
  document.body.append(root);
  editor.setRootElement(root);
  root.focus();
  const history = registerHistory(editor, createEmptyHistoryState(), 0);
  let reply: ((s: string) => void) | undefined;
  const stop = registerAutocomplete(editor, {
    title: "",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: async () =>
      new Promise<string>((resolve) => {
        reply = resolve;
      }),
  });
  let key = "";
  editor.update(
    () => {
      const text = $createTextNode("今日は");
      key = text.getKey();
      $getRoot().append($createParagraphNode().append(text));
      text.selectEnd();
    },
    { discrete: true },
  );
  await pause();
  editor.update(() => $setCompositionKey(key), { discrete: true });
  reply?.("晴れです。");
  await pause();
  expect(root.querySelector("[data-suggestion]")).toBeNull();
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    "今日は",
  );
  editor.update(() => $setCompositionKey(null), { discrete: true });
  editor.update(
    () => {
      $getSelection()?.insertText("日本");
    },
    { discrete: true },
  );
  await pause();
  reply?.("晴れです。");
  await pause();
  editor.dispatchCommand(
    KEY_TAB_COMMAND,
    new window.KeyboardEvent("keydown", { key: "Tab" }),
  );
  await pause();
  expect(root.textContent).toBe("今日は日本晴れです。");
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    expect($isRangeSelection(selection) && selection.isCollapsed()).toBe(true);
  });
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  await pause();
  expect(root.textContent).toBe("今日は日本");
  editor.update(
    () => {
      const node = $getRoot().getLastDescendant();
      if ($isTextNode(node)) {
        const selection = node.select(4, 5);
        selection.removeText();
      }
    },
    { discrete: true },
  );
  await pause();
  expect(root.textContent).toBe("今日は日");
  stop();
  reply?.("discarded");
  await pause();
  history();
  editor.setRootElement(null);
  root.remove();
});

test("switching documents waits for the previous editor request to finish", async () => {
  const editors = [
    createEditor({
      namespace: "doc1",
      onError: (e) => {
        throw e;
      },
    }),
    createEditor({
      namespace: "doc2",
      onError: (e) => {
        throw e;
      },
    }),
  ] as const;
  const roots = editors.map((editor) => {
    const root = document.createElement("div");
    root.setAttribute("contenteditable", "true");
    root.tabIndex = 0;
    document.body.append(root);
    editor.setRootElement(root);
    return root;
  });
  let calls = 0;
  let reply: ((text: string) => void) | undefined;
  const stopFirst = registerAutocomplete(editors[0], {
    title: "First",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: async () => {
      calls++;
      return new Promise((resolve) => {
        reply = resolve;
      });
    },
  });
  const typeInto = (editor: (typeof editors)[number]) => {
    editor.getRootElement()?.focus();
    editor.update(
      () => {
        const text = $createTextNode("Hello");
        $getRoot().append($createParagraphNode().append(text));
        text.selectEnd();
      },
      { discrete: true },
    );
  };
  typeInto(editors[0]);
  await pause();
  stopFirst();
  const stopSecond = registerAutocomplete(editors[1], {
    title: "Second",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: async () => {
      calls++;
      return " new document";
    },
  });
  typeInto(editors[1]);
  await pause();
  expect(calls).toBe(1);
  reply?.(" old document");
  await pause();
  expect(calls).toBe(2);
  expect(roots[0]?.querySelector("[data-suggestion]")).toBeNull();
  expect(
    roots[1]
      ?.querySelector("[data-suggestion]")
      ?.getAttribute("data-suggestion"),
  ).toBe(" new document");
  stopSecond();
  for (const editor of editors) editor.setRootElement(null);
  for (const root of roots) root.remove();
});
