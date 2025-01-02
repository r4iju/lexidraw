import "./index.css";
import {
  $isCodeNode,
  CodeNode,
  getLanguageFriendlyName,
  normalizeCodeLang,
} from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode } from "lexical";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CopyButton } from "./components/CopyButton";
import { canBePrettier, PrettierButton } from "./components/PrettierButton";
import { useDebounce } from "./utils";

const CODE_PADDING = 8;

type Position = {
  top: string;
  right: string;
};

function CodeActionMenuContainer({ anchorElem }: { anchorElem: HTMLElement }) {
  const [editor] = useLexicalComposerContext();
  const [lang, setLang] = useState("");
  const [isShown, setShown] = useState<boolean>(false);
  const [shouldListenMouseMove, setShouldListenMouseMove] =
    useState<boolean>(false);
  const [position, setPosition] = useState<Position>({ right: "0", top: "0" });

  // Store the actual code DOM node in React state
  const [codeDOMNode, setCodeDOMNode] = useState<HTMLElement | null>(null);

  const codeSetRef = useRef<Set<string>>(new Set());

  const debouncedOnMouseMove = useDebounce((event: MouseEvent) => {
    const { codeDOMNode: maybeDOMNode, isOutside } = getMouseInfo(event);
    if (isOutside) {
      setShown(false);
      return;
    }
    if (!maybeDOMNode) return;

    let codeNode: CodeNode | null = null;
    let _lang = "";

    editor.update(() => {
      const maybeCodeNode = $getNearestNodeFromDOMNode(maybeDOMNode);
      if ($isCodeNode(maybeCodeNode)) {
        codeNode = maybeCodeNode;
        _lang = codeNode.getLanguage() || "";
      }
    });

    if (codeNode) {
      const { y: editorElemY, right: editorElemRight } =
        anchorElem.getBoundingClientRect();
      const { y, right } = maybeDOMNode.getBoundingClientRect();

      setLang(_lang);
      setShown(true);
      setPosition({
        right: `${editorElemRight - right + CODE_PADDING}px`,
        top: `${y - editorElemY}px`,
      });

      // Update our state with the DOM node
      setCodeDOMNode(maybeDOMNode);
    }
  }, 50);

  useEffect(() => {
    if (!shouldListenMouseMove) return;
    document.addEventListener("mousemove", debouncedOnMouseMove);

    return () => {
      setShown(false);
      debouncedOnMouseMove.cancel();
      document.removeEventListener("mousemove", debouncedOnMouseMove);
    };
  }, [shouldListenMouseMove, debouncedOnMouseMove]);

  // Register code node mutations
  useEffect(() => {
    // Return the "unregister" handler so it cleans up
    return editor.registerMutationListener(CodeNode, (mutations) => {
      editor.getEditorState().read(() => {
        for (const [key, type] of mutations) {
          switch (type) {
            case "created":
              codeSetRef.current.add(key);
              setShouldListenMouseMove(codeSetRef.current.size > 0);
              break;
            case "destroyed":
              codeSetRef.current.delete(key);
              setShouldListenMouseMove(codeSetRef.current.size > 0);
              break;
            default:
              break;
          }
        }
      });
    });
  }, [editor]);

  const normalizedLang = normalizeCodeLang(lang);
  const codeFriendlyName = getLanguageFriendlyName(lang);

  return createPortal(
    <>
      {isShown && (
        <div className="code-action-menu-container" style={{ ...position }}>
          <div className="code-highlight-language">{codeFriendlyName}</div>
          {/* Now we pass the actual DOM node down instead of a getter function */}
          <CopyButton editor={editor} codeDOMNode={codeDOMNode} />
          {canBePrettier(normalizedLang) && (
            <PrettierButton
              editor={editor}
              codeDOMNode={codeDOMNode}
              lang={normalizedLang}
            />
          )}
        </div>
      )}
    </>,
    anchorElem,
  );
}

function getMouseInfo(event: MouseEvent) {
  const target = event.target;
  if (target && target instanceof HTMLElement) {
    const codeDOMNode = target.closest<HTMLElement>(
      "code.PlaygroundEditorTheme__code",
    );
    const isOutside = !(
      codeDOMNode ||
      target.closest<HTMLElement>("div.code-action-menu-container")
    );
    return { codeDOMNode, isOutside };
  }
  return { codeDOMNode: null, isOutside: true };
}

export default function CodeActionMenuPlugin({ anchorElem = document.body }) {
  return <CodeActionMenuContainer anchorElem={anchorElem} />;
}
