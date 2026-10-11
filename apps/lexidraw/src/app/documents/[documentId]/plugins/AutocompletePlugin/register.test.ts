import { expect, test } from "bun:test";
import { installDom } from "~/test/dom";
installDom();
globalThis.fetch = Object.assign(
  async () => {
    throw new Error("Network refused: synthetic review only");
  },
  { preconnect() {} },
);
const {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  BLUR_COMMAND,
} = await import("lexical");
const { registerAutocomplete } = await import("./register");
const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
test("queued suggestion must stay cancelled after blur while another editor request completes", async () => {
  const editors = [0, 1].map((i) =>
    createEditor({
      namespace: `review${i}`,
      onError(e) {
        throw e;
      },
    }),
  );
  const roots = editors.map((editor) => {
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);
    editor.setRootElement(root);
    return root;
  });
  let finish: ((text: string) => void) | undefined;
  let starts = 0;
  const stopFirst = registerAutocomplete(editors[0]!, {
    title: "first",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const type = (i: number) =>
    editors[i]!.update(
      () => {
        const text = $createTextNode("Hello");
        $getRoot().append($createParagraphNode().append(text));
        text.selectEnd();
      },
      { discrete: true },
    );
  type(0);
  await pause();
  const stopSecond = registerAutocomplete(editors[1]!, {
    title: "second",
    delayMs: 0,
    minIntervalMs: 0,
    suggest: async () => {
      starts++;
      return " unexpected suggestion";
    },
  });
  type(1);
  await pause();
  expect(starts).toBe(0);
  editors[1]!.dispatchCommand(BLUR_COMMAND, new window.FocusEvent("blur"));
  await pause();
  finish?.("first completed");
  await pause();
  await pause();
  const paintedAfterBlur = roots[1]?.querySelector("[data-suggestion]");
  stopFirst();
  stopSecond();
  for (const e of editors) e.setRootElement(null);
  for (const r of roots) r.remove();
  expect(starts).toBe(0);
  expect(paintedAfterBlur).toBeNull();
});
