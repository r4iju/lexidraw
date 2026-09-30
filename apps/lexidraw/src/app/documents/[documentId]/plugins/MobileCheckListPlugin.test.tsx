/// <reference types="bun" />
import { installDom, render } from "~/test/dom";
installDom();
import { expect, test } from "bun:test";
import { act } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { $createTextNode, $getRoot } from "lexical";
import MobileCheckListPlugin from "./MobileCheckListPlugin";

test("a checklist whose direction is inherited toggles from its right edge", async () => {
  const { unmount } = await render(
    <LexicalComposer
      initialConfig={{
        namespace: "direction-test",
        nodes: [ListNode, ListItemNode],
        onError(error) {
          throw error;
        },
        editorState() {
          $getRoot().append(
            $createListNode("check").append(
              $createListItemNode(false).append($createTextNode("abc")),
            ),
          );
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <MobileCheckListPlugin />
    </LexicalComposer>,
  );
  try {
    const item = document.querySelector("li");
    expect(item).not.toBeNull();
    if (!item) throw new Error("No checklist item");
    item.dir = "auto";
    item.style.direction = "rtl";
    item.getBoundingClientRect = () => new DOMRect(0, 0, 300, 30);
    const event = new Event("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerType: { value: "touch" },
      clientX: { value: 290 },
      pageX: { value: 290 },
    });
    await act(async () => {
      item.dispatchEvent(event);
    });
    expect(item.getAttribute("aria-checked")).toBe("true");
  } finally {
    await unmount();
  }
});
