/// <reference types="bun" />
import { installDom, render, click } from "~/test/dom";
installDom();
import { afterEach, expect, mock, test } from "bun:test";
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $createNodeSelection,
  $setSelection,
} from "lexical";
import {
  $createTableNodeWithDimensions,
  TableNode,
  TableCellNode,
  TableRowNode,
} from "@lexical/table";
import {
  LexicalComposerContext,
  createLexicalComposerContext,
} from "@lexical/react/LexicalComposerContext";
import { act, createContext, type ComponentProps } from "react";
mock.module("next/navigation", () => ({
  usePathname: () => "/documents/1",
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));
mock.module("~/hooks/use-auto-save", () => ({
  useAutoSave: () => ({ enabled: false }),
}));
mock.module("~/hooks/use-open-entity-sync", () => ({
  OpenEntityContext: createContext(null),
}));
const { PhoneBar } = await import("./phone-bar");
const { TooltipProvider } = await import("~/components/ui/tooltip");
const { UnsavedChangesProvider } = await import("~/hooks/use-unsaved-changes");
const { DocumentSettingsProvider } = await import(
  "../../context/document-settings-context"
);
let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});
for (const current of ["default", "selection", "table", "block"] as const) {
  test(`hides the keyboard without navigation in ${current} mode, outside the scrolling controls`, async () => {
    const editor = createEditor({
      nodes: [TableNode, TableRowNode, TableCellNode],
      onError(error) {
        throw error;
      },
    });
    editor.update(
      () => {
        const text = $createTextNode("Hello world");
        const table = $createTableNodeWithDimensions(2, 2, false);
        $getRoot().append($createParagraphNode().append(text), table);
        if (current === "default") text.select(0, 0);
        if (current === "selection") text.select(0, 5);
        if (current === "table") table.selectStart();
        if (current === "block") {
          const selection = $createNodeSelection();
          selection.add(table.getKey());
          $setSelection(selection);
        }
      },
      { discrete: true },
    );
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    const href = window.location.href;
    const props: ComponentProps<typeof PhoneBar> = {
      editor,
      formats: new Set(),
      inCode: false,
      isLink: false,
      toggleLink() {},
      blockType: "paragraph",
      canUndo: false,
      canRedo: false,
      fontValue: "Arial",
      fontSize: "16",
      fontColor: "#000000",
      bgColor: "#ffffff",
      onFontColorSelect() {},
      onBgColorSelect() {},
      elementFormat: "left",
      isRTL: false,
      signedIn: false,
      showModal() {},
    };
    ({ unmount } = await render(
      <UnsavedChangesProvider saveBeforeLeaving={async () => true}>
        <DocumentSettingsProvider>
          <TooltipProvider>
            <LexicalComposerContext.Provider
              value={[editor, createLexicalComposerContext(null, {})]}
            >
              <PhoneBar {...props} />
            </LexicalComposerContext.Provider>
          </TooltipProvider>
        </DocumentSettingsProvider>
      </UnsavedChangesProvider>,
    ));
    try {
      const hide = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Hide keyboard"]',
      );
      expect(
        document
          .querySelector("[data-bar-mode]")
          ?.getAttribute("data-bar-mode"),
      ).toBe(current);
      expect(hide).not.toBeNull();
      expect(hide?.closest(".overflow-x-auto")).toBeNull();
      await act(async () => {
        await click(hide);
      });
      expect(document.activeElement).not.toBe(input);
      expect(window.location.href).toBe(href);
      expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    } finally {
      input.remove();
    }
  });
}
