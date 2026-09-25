/// <reference types="bun" />
import { expect, mock, test } from "bun:test";
import { Suspense } from "react";
import { installDom, render } from "~/test/dom";

installDom();
const offline = Promise.reject(new Error("offline"));
offline.catch(() => {});
// No other test loads KaTeX, so this stand-in reaches no one else.
mock.module("~/lib/katex", () => ({
  loadKatex: () => offline,
  loadedKatex: () => undefined,
  katexOptions: () => ({}),
}));
const { default: KatexRenderer } = await import("./katex-renderer");

test("an equation whose KaTeX cannot load shows its TeX, and only it fails", async () => {
  const view = await render(
    <div>
      <p>Before the equation.</p>
      <Suspense fallback={null}>
        <KatexRenderer
          equation="e^{i\pi} + 1 = 0"
          inline
          onDoubleClick={() => {}}
        />
      </Suspense>
    </div>,
  );
  await new Promise((settle) => setTimeout(settle, 10));
  expect(document.body.textContent).toContain("Before the equation.");
  expect(document.querySelector("code")?.textContent).toBe("e^{i\\pi} + 1 = 0");
  await view.unmount();
});
