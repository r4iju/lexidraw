import "./index.css";
import {
  $isCodeNode,
  CodeNode,
  getLanguageFriendlyName,
  normalizeCodeLang,
} from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode } from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CopyButton } from "./components/CopyButton";
import { canBePrettier, PrettierButton } from "./components/PrettierButton";
import { useDebounce } from "~/lib/client-utils";

const CODE_PADDING = 8;

type Position = {
  top: string;
  right: string;
};

function CodeActionMenuContainer({
  anchorElem,
}: {
  anchorElem: HTMLElement;
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [lang, setLang] = useState("");
  const [isShown, setShown] = useState<boolean>(false);
  const [shouldListenMouseMove, setShouldListenMouseMove] =
    useState<boolean>(false);
  const [position, setPosition] = useState<Position>({
    right: "0",
    top: "0",
  });

  const codeSetRef = useRef<Set<string>>(new Set());
  const codeDOMNodeRef = useRef<HTMLElement | null>(null);

  /**
   * 1. Provide a stable callback that returns the ref value.
   *    We'll pass this to the child components instead of the raw ref.
   */
  const getCodeDOMNode = useCallback(() => {
    return codeDOMNodeRef.current;
  }, []);

  const { run: debouncedOnMouseMove, cancel: cancelDebouncedOnMouseMove } =
    useDebounce((event: MouseEvent) => {
      const { codeDOMNode, isOutside } = getMouseInfo(event);
      if (isOutside) {
        setShown(false);
        return;
      }

      if (!codeDOMNode) {
        return;
      }

      let codeNode: CodeNode | null = null;
      let _lang = "";

      editor.update(() => {
        const maybeCodeNode = $getNearestNodeFromDOMNode(codeDOMNode);
        if ($isCodeNode(maybeCodeNode)) {
          codeNode = maybeCodeNode;
          _lang = codeNode.getLanguage() || "";
        }
      });

      if (codeNode) {
        const { y: editorElemY, right: editorElemRight } =
          anchorElem.getBoundingClientRect();
        const { y, right } = codeDOMNode.getBoundingClientRect();
        setLang(_lang);
        setShown(true);
        setPosition({
          right: `${editorElemRight - right + CODE_PADDING}px`,
          top: `${y - editorElemY}px`,
        });

        /**
         * 2. Store the new node in the ref,
         *    but don't read it in the render path.
         */
        codeDOMNodeRef.current = codeDOMNode;
      }
    }, 50);

  useEffect(() => {
    if (!shouldListenMouseMove) {
      return;
    }
    document.addEventListener("mousemove", debouncedOnMouseMove);
    return () => {
      setShown(false);
      cancelDebouncedOnMouseMove();
      document.removeEventListener("mousemove", debouncedOnMouseMove);
    };
  }, [shouldListenMouseMove, debouncedOnMouseMove, cancelDebouncedOnMouseMove]);

  // Register a mutation listener so we know when code nodes are added/removed
  useEffect(() => {
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

  return (
    <>
      {isShown ? (
        <div className="code-action-menu-container" style={{ ...position }}>
          <div className="code-highlight-language">{codeFriendlyName}</div>

          {/**
           * 3. Instead of passing a DOM node directly (or a ref),
           *    we pass getCodeDOMNode, a stable callback,
           *    which will only be called inside an event handler in the children.
           */}
          <CopyButton editor={editor} getCodeDOMNode={getCodeDOMNode} />

          {canBePrettier(normalizedLang) ? (
            <PrettierButton
              editor={editor}
              getCodeDOMNode={getCodeDOMNode}
              lang={normalizedLang}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function getMouseInfo(event: MouseEvent): {
  codeDOMNode: HTMLElement | null;
  isOutside: boolean;
} {
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
  } else {
    return { codeDOMNode: null, isOutside: true };
  }
}

export default function CodeActionMenuPlugin({
  anchorElem = document.body,
}: {
  anchorElem?: HTMLElement;
}): React.ReactPortal | null {
  return createPortal(
    <CodeActionMenuContainer anchorElem={anchorElem} />,
    anchorElem,
  );
}
