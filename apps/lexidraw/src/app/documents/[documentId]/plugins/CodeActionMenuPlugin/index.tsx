import { DocumentCodeNode } from "@packages/lexical-nodes";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import {
  $getNodeByKey,
  $nodesOfType,
  $isLineBreakNode,
  type NodeKey,
} from "lexical";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CODE_LANGUAGE_OPTIONS,
  getCodeLanguageFriendlyName,
  normalizeCodeLanguage,
} from "../code-language";
import { CopyButton } from "./copy-button";
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
  // Lexical owns the code DOM and notifies us when its header or line markers change.
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
              let line = 1;
              let first = true;
              for (const child of node.getChildren()) {
                const dom = editor.getElementByKey(child.getKey());
                if (dom) {
                  dom.removeAttribute("data-line-number");
                  if (first) dom.dataset.lineNumber = String(line);
                }
                if ($isLineBreakNode(child)) {
                  line++;
                  first = true;
                } else first = false;
              }
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

  return headers.map(({ key, element, code, language, numbers }) =>
    createPortal(
      <>
        {editable ? (
          <select
            aria-label="Code language"
            value={language}
            onChange={(event) => {
              const value = event.target.value;
              editor.update(() => {
                const node = $getNodeByKey(key);
                if (node instanceof DocumentCodeNode) node.setLanguage(value);
              });
            }}
          >
            <option value="">Plain text</option>
            {language &&
              !CODE_LANGUAGE_OPTIONS.some(([value]) => value === language) && (
                <option value={language}>
                  {getCodeLanguageFriendlyName(language)}
                </option>
              )}
            {CODE_LANGUAGE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <span>{getCodeLanguageFriendlyName(language) || "Plain text"}</span>
        )}
        <div className="document-code-actions">
          {editable && (
            <label title="Show line numbers">
              <input
                type="checkbox"
                aria-label="Show line numbers"
                checked={numbers}
                onChange={(event) => {
                  const checked = event.target.checked;
                  editor.update(() => {
                    const node = $getNodeByKey(key);
                    if (node instanceof DocumentCodeNode)
                      node.setShowLineNumbers(checked);
                  });
                }}
              />{" "}
              Lines
            </label>
          )}
          <CopyButton editor={editor} getCodeDOMNode={() => code} />
          {editable &&
            ["css", "html", "javascript", "markdown", "typescript"].includes(
              normalizeCodeLanguage(language),
            ) && (
              <PrettierButton
                editor={editor}
                getCodeDOMNode={() => code}
                lang={normalizeCodeLanguage(language)}
              />
            )}
        </div>
      </>,
      element,
      key,
    ),
  );
}
