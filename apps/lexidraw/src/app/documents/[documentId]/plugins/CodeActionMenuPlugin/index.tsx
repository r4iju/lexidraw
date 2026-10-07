import { DocumentCodeNode } from "@packages/lexical-nodes";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { $findMatchingParent } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $nodesOfType,
  type NodeKey,
} from "lexical";
import { ListOrderedIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Toggle } from "~/components/ui/toggle";
import {
  getCodeLanguageFriendlyName,
  normalizeCodeLanguage,
} from "../code-language";
import { CopyButton } from "./copy-button";
import { LanguagePicker } from "./language-picker";
import { PrettierButton } from "./prettier-button";

type Header = {
  key: NodeKey;
  element: HTMLElement;
  code: HTMLElement;
  language: string;
  numbers: boolean;
};

export default function CodeActionMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const editable = useLexicalEditable();
  const [headers, setHeaders] = useState<Header[]>([]);
  const [caretIn, setCaretIn] = useState<NodeKey | null>(null);
  // Lexical owns the code DOM and notifies us when a block's header changes.
  useEffect(
    () =>
      editor.registerMutationListener(
        DocumentCodeNode,
        () => {
          editor.getEditorState().read(() => {
            const next: Header[] = [];
            $nodesOfType(DocumentCodeNode).forEach((node) => {
              if (!(node instanceof DocumentCodeNode) || !node.isAttached())
                return;
              const code = editor.getElementByKey(node.getKey());
              const element = code?.querySelector<HTMLElement>(
                ".document-code-header",
              );
              if (!code || !element) return;
              next.push({
                key: node.getKey(),
                element,
                code,
                language: node.getLanguage() || "",
                numbers: node.getShowLineNumbers(),
              });
            });
            setHeaders(next);
          });
        },
        { skipInitialization: false },
      ),
    [editor],
  );
  // Lexical's selection: the block holding the caret shows its controls, so
  // they appear for keyboard editing as they do for a hovering pointer.
  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const anchor = $getSelection()?.getNodes()[0];
          const block = anchor
            ? $findMatchingParent(
                anchor,
                (node) => node instanceof DocumentCodeNode,
              )
            : null;
          setCaretIn(block?.getKey() ?? null);
        });
      }),
    [editor],
  );

  return headers.map(({ key, element, code, language, numbers }) =>
    createPortal(
      <div
        className="document-code-controls"
        data-active={key === caretIn ? "" : undefined}
      >
        {editable ? (
          <LanguagePicker
            language={language}
            onChange={(value) => {
              editor.update(() => {
                const node = $getNodeByKey(key);
                if (node instanceof DocumentCodeNode) node.setLanguage(value);
              });
            }}
          />
        ) : (
          <span className="document-code-language">
            {getCodeLanguageFriendlyName(language) || "Plain text"}
          </span>
        )}
        {editable && (
          <Toggle
            size="sm"
            aria-label="Show line numbers"
            title={numbers ? "Hide line numbers" : "Show line numbers"}
            className="size-7 p-0 pointer-coarse:size-11"
            pressed={numbers}
            onPressedChange={(pressed) => {
              editor.update(() => {
                const node = $getNodeByKey(key);
                if (node instanceof DocumentCodeNode)
                  node.setShowLineNumbers(pressed);
              });
            }}
          >
            <ListOrderedIcon className="size-4" />
          </Toggle>
        )}
        {editable && (
          <PrettierButton
            editor={editor}
            getCodeDOMNode={() => code}
            lang={normalizeCodeLanguage(language)}
          />
        )}
        <CopyButton editor={editor} getCodeDOMNode={() => code} />
      </div>,
      element,
      key,
    ),
  );
}
