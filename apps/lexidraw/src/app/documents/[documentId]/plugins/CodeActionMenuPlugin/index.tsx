import { DocumentCodeNode } from "@packages/lexical-nodes";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { $getNodeByKey, $nodesOfType, type NodeKey } from "lexical";
import { ListOrderedIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "~/components/ui/button";
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

  return headers.map(({ key, element, code, language, numbers }) =>
    createPortal(
      <>
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
          <span>{getCodeLanguageFriendlyName(language) || "Plain text"}</span>
        )}
        <div className="document-code-actions">
          {editable && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Show line numbers"
              aria-pressed={numbers}
              title={numbers ? "Hide line numbers" : "Show line numbers"}
              onClick={() => {
                editor.update(() => {
                  const node = $getNodeByKey(key);
                  if (node instanceof DocumentCodeNode)
                    node.setShowLineNumbers(!numbers);
                });
              }}
            >
              <ListOrderedIcon />
            </Button>
          )}
          {editable && (
            <PrettierButton
              editor={editor}
              getCodeDOMNode={() => code}
              lang={normalizeCodeLanguage(language)}
            />
          )}
          <CopyButton editor={editor} getCodeDOMNode={() => code} />
        </div>
      </>,
      element,
      key,
    ),
  );
}
