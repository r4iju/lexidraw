import { $isCodeHighlightNode } from "@lexical/code";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import {
  Bold,
  Code,
  Italic,
  Link,
  type LucideIcon,
  MessageSquareText,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";
import {
  type Dispatch,
  type JSX,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useFinePointer } from "~/hooks/use-media-query";
import { placeFloating } from "~/lib/place-floating";
import { useGetSelectedNode } from "../../utils/getSelectedNode";
import { INSERT_INLINE_COMMAND } from "../CommentPlugin";
import { Toolbar, ToolbarButton } from "../ToolbarPlugin/toolbar";

type Mark = {
  format: TextFormatType;
  label: string;
  icon: LucideIcon;
  shortcut: string;
};

const MARKS: Mark[] = [
  { format: "bold", label: "Bold", icon: Bold, shortcut: "Mod+B" },
  { format: "italic", label: "Italic", icon: Italic, shortcut: "Mod+I" },
  {
    format: "underline",
    label: "Underline",
    icon: Underline,
    shortcut: "Mod+U",
  },
  {
    format: "strikethrough",
    label: "Strikethrough",
    icon: Strikethrough,
    shortcut: "Mod+Shift+S",
  },
];

const SCRIPTS: Mark[] = [
  {
    format: "subscript",
    label: "Subscript",
    icon: Subscript,
    shortcut: "Mod+,",
  },
  {
    format: "superscript",
    label: "Superscript",
    icon: Superscript,
    shortcut: "Mod+.",
  },
];

const ALL_FORMATS = [...MARKS, ...SCRIPTS].map(({ format }) => format);

/** The page toolbar's bottom: the selection toolbar never goes under it. */
function topBound() {
  return (
    document
      .querySelector('[role="toolbar"][aria-label="Formatting"]')
      ?.getBoundingClientRect().bottom ?? 0
  );
}

function selectionRect(rootElement: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
    return null;
  if (!rootElement.contains(selection.anchorNode)) return null;
  if (selection.anchorNode === rootElement) {
    let inner = rootElement;
    while (inner.firstElementChild)
      inner = inner.firstElementChild as HTMLElement;
    return inner.getBoundingClientRect();
  }
  return selection.getRangeAt(0).getBoundingClientRect();
}

function SelectionToolbar({
  editor,
  formats,
  isLink,
  setIsLinkEditMode,
}: {
  editor: LexicalEditor;
  formats: Set<TextFormatType>;
  isLink: boolean;
  setIsLinkEditMode: Dispatch<boolean>;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const element = ref.current;
    const root = editor.getRootElement();
    if (!element || !root) return;
    const target = selectionRect(root);
    if (!target) {
      element.style.opacity = "0";
      return;
    }
    const { left, top } = placeFloating(
      target,
      { width: element.offsetWidth, height: element.offsetHeight },
      {
        top: topBound(),
        left: 0,
        right: document.documentElement.clientWidth,
        bottom: window.innerHeight,
      },
      { side: "above" },
    );
    // Measured from wherever `fixed` starts: a dialog's transform moves it.
    element.style.left = "0px";
    element.style.top = "0px";
    const origin = element.getBoundingClientRect();
    element.style.left = `${left - origin.left}px`;
    element.style.top = `${top - origin.top}px`;
    element.style.opacity = "1";
  }, [editor]);

  useLayoutEffect(place);

  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const unregister = editor.registerUpdateListener(place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      unregister();
    };
  }, [editor, place]);

  // While the pointer drags a selection, it passes through the toolbar.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const element = ref.current;
      if (!element || !(event.buttons & 1)) return;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      if (!element.contains(under)) element.style.pointerEvents = "none";
    };
    const onUp = () => {
      if (ref.current) ref.current.style.pointerEvents = "auto";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  const toggleLink = () => {
    setIsLinkEditMode(!isLink);
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, isLink ? null : "https://");
  };
  const buttons = (marks: Mark[]) =>
    marks.map(({ format, label, icon, shortcut }) => (
      <ToolbarButton
        key={format}
        label={label}
        shortcut={shortcut}
        icon={icon}
        pressed={formats.has(format)}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format)}
      />
    ));

  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 z-50 rounded-lg border border-border-subtle bg-popover px-1 opacity-0 shadow-[var(--elevation-overlay)] transition-opacity duration-base motion-reduce:transition-none"
    >
      <Toolbar
        label="Selection formatting"
        overflow={false}
        className="flex-none"
        groups={[
          { id: "marks", label: "Text style", content: buttons(MARKS) },
          { id: "script", label: "Script", content: buttons(SCRIPTS) },
          {
            id: "inline",
            label: "Code and link",
            content: (
              <>
                <ToolbarButton
                  label="Inline code"
                  shortcut="Mod+Shift+C"
                  icon={Code}
                  pressed={formats.has("code")}
                  onClick={() =>
                    editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")
                  }
                />
                <ToolbarButton
                  label="Link"
                  shortcut="Mod+K"
                  icon={Link}
                  pressed={isLink}
                  onClick={toggleLink}
                />
              </>
            ),
          },
          {
            id: "comment",
            label: "Comment",
            content: (
              <ToolbarButton
                label="Comment"
                icon={MessageSquareText}
                onClick={() =>
                  editor.dispatchCommand(INSERT_INLINE_COMMAND, undefined)
                }
              />
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * Formatting next to a text selection, for mouse and trackpad: on touch the
 * platform's own selection menu takes that place, and the page toolbar does
 * the rest.
 */
export default function FloatingTextFormatToolbarPlugin({
  setIsLinkEditMode,
}: {
  setIsLinkEditMode: Dispatch<boolean>;
}): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const fine = useFinePointer();
  const getSelectedNode = useGetSelectedNode();
  const [isText, setIsText] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [formats, setFormats] = useState<Set<TextFormatType>>(new Set());

  const update = useCallback(() => {
    editor.read(() => {
      // Not while an input method is composing.
      if (editor.isComposing()) return;
      const selection = $getSelection();
      const native = window.getSelection();
      const root = editor.getRootElement();
      if (
        !$isRangeSelection(selection) ||
        !native ||
        !root?.contains(native.anchorNode) ||
        selection.isCollapsed()
      ) {
        setIsText(false);
        return;
      }
      const node = getSelectedNode(selection);
      setFormats(
        new Set(
          [...ALL_FORMATS, "code" as const].filter((format) =>
            selection.hasFormat(format),
          ),
        ),
      );
      setIsLink($isLinkNode(node.getParent()) || $isLinkNode(node));
      setIsText(
        !$isCodeHighlightNode(selection.anchor.getNode()) &&
          selection.getTextContent().replace(/\n/g, "") !== "" &&
          ($isTextNode(node) || $isParagraphNode(node)),
      );
    });
  }, [editor, getSelectedNode]);

  useEffect(() => {
    document.addEventListener("selectionchange", update);
    return mergeRegister(
      () => document.removeEventListener("selectionchange", update),
      editor.registerUpdateListener(update),
      editor.registerRootListener(() => {
        if (editor.getRootElement() === null) setIsText(false);
      }),
    );
  }, [editor, update]);

  const root = editor.getRootElement();
  if (!fine || !isText || !root || !editor.isEditable()) return null;
  // Inside a dialog, only the dialog takes pointer input.
  return createPortal(
    <SelectionToolbar
      editor={editor}
      formats={formats}
      isLink={isLink}
      setIsLinkEditMode={setIsLinkEditMode}
    />,
    root.closest<HTMLElement>('[role="dialog"]') ?? document.body,
  );
}
