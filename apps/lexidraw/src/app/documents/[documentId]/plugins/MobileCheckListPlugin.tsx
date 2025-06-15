import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { $getNearestNodeFromDOMNode } from "lexical";
import { $isListItemNode } from "@lexical/list";

// A small helper – the same one used inside Lexical (but not exported)
function isHTMLElement(node: unknown): node is HTMLElement {
  return node instanceof HTMLElement;
}

/**
 * Mobile Safari / Chrome do not emit the subsequent `click` event when
 * `pointerdown` is cancelled – Lexical does cancel it for checklist items
 * to keep the caret from jumping. This breaks the built-in toggle handler.
 *
 * We restore the behaviour by listening to the `pointerup` event and
 * toggling the item ourselves when the user tapped inside the left-hand
 * checkbox area (40 px for a comfortable finger target).
 */
export default function MobileCheckListPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    const toggleOnTouch = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const target = event.target as unknown;
      if (!isHTMLElement(target)) return;
      const li = target.closest("li");
      if (!li) return;
      // Lexical stores list type on an internal field __lexicalListType.
      // We check for the presence of aria-checked instead – cheaper & public.
      if (!li.hasAttribute("role") || li.getAttribute("role") !== "checkbox")
        return;

      const rect = li.getBoundingClientRect();
      const pageX = event.pageX;
      const isRtl = li.dir === "rtl";
      const hitArea = 40; // px

      const inside = isRtl
        ? pageX < rect.right && pageX > rect.right - hitArea
        : pageX > rect.left && pageX < rect.left + hitArea;

      if (!inside) return;

      event.preventDefault();
      event.stopPropagation();

      editor.update(() => {
        const listItemNode = $getNearestNodeFromDOMNode(li);
        if ($isListItemNode(listItemNode)) {
          listItemNode.toggleChecked();
        }
      });
    };

    root.addEventListener("pointerup", toggleOnTouch, true);
    return () => root.removeEventListener("pointerup", toggleOnTouch, true);
  }, [editor]);

  return null;
}
