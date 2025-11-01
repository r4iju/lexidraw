import "./index.css";

import {
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  type BaseSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { type Dispatch, useCallback, useEffect, useRef, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";

import { useGetSelectedNode } from "../../../utils/getSelectedNode";
import { useSanitizeUrl } from "../../../utils/url";
import { Button } from "~/components/ui/button";
import { CheckIcon, PencilIcon, TrashIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { Input } from "~/components/ui/input";

function FloatingLinkEditor({
  editor,
  isLink,
  setIsLink,
  anchorElem,
  isLinkEditMode,
  setIsLinkEditMode,
}: {
  editor: LexicalEditor;
  isLink: boolean;
  setIsLink: Dispatch<boolean>;
  anchorElem: HTMLElement;
  isLinkEditMode: boolean;
  setIsLinkEditMode: Dispatch<boolean>;
}): React.JSX.Element {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [editedLinkUrl, setEditedLinkUrl] = useState("https://");
  const [lastSelection, setLastSelection] = useState<BaseSelection | null>(
    null,
  );
  const getSelectedNode = useGetSelectedNode();
  const sanitizeUrl = useSanitizeUrl();

  const VERTICAL_GAP = 10;
  const HORIZONTAL_OFFSET = 5;

  const setFloatingElemPositionForLinkEditor = useCallback(
    (
      targetRect: DOMRect | null,
      floatingElem: HTMLElement,
      anchorElem: HTMLElement,
      verticalGap: number = VERTICAL_GAP,
      horizontalOffset: number = HORIZONTAL_OFFSET,
    ): void => {
      const scrollerElem = anchorElem.parentElement;

      if (targetRect === null || !scrollerElem) {
        floatingElem.style.opacity = "0";
        floatingElem.style.transform = "translate(-10000px, -10000px)";
        return;
      }

      const floatingElemRect = floatingElem.getBoundingClientRect();
      const anchorElementRect = anchorElem.getBoundingClientRect();
      const editorScrollerRect = scrollerElem.getBoundingClientRect();

      let top = targetRect.top - verticalGap;
      let left = targetRect.left - horizontalOffset;

      if (top < editorScrollerRect.top) {
        top += floatingElemRect.height + targetRect.height + verticalGap * 2;
      }

      if (left + floatingElemRect.width > editorScrollerRect.right) {
        left =
          editorScrollerRect.right - floatingElemRect.width - horizontalOffset;
      }

      top -= anchorElementRect.top;
      left -= anchorElementRect.left;

      floatingElem.style.opacity = "1";
      floatingElem.style.transform = `translate(${left}px, ${top}px)`;
    },
    [],
  );

  const $updateLinkEditor = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      const node = getSelectedNode(selection);
      const linkParent = $findMatchingParent(node, $isLinkNode);

      if (linkParent) {
        setLinkUrl(linkParent.getURL());
      } else if ($isLinkNode(node)) {
        setLinkUrl(node.getURL());
      } else {
        setLinkUrl("");
      }
      if (isLinkEditMode) {
        setEditedLinkUrl(linkUrl);
      }
    }
    const editorElem = editorRef.current;
    const nativeSelection = window.getSelection();
    const activeElement = document.activeElement;

    if (editorElem === null) {
      return;
    }

    const rootElement = editor.getRootElement();

    if (
      selection !== null &&
      nativeSelection !== null &&
      rootElement !== null &&
      rootElement.contains(nativeSelection.anchorNode) &&
      editor.isEditable()
    ) {
      const domRect: DOMRect | undefined =
        nativeSelection.focusNode?.parentElement?.getBoundingClientRect();
      if (domRect) {
        domRect.y += 40;
        setFloatingElemPositionForLinkEditor(domRect, editorElem, anchorElem);
      }
      setLastSelection(selection);
    } else if (!activeElement || activeElement.className !== "link-input") {
      if (rootElement !== null) {
        setFloatingElemPositionForLinkEditor(null, editorElem, anchorElem);
      }
      setLastSelection(null);
      setIsLinkEditMode(false);
      setLinkUrl("");
    }

    return true;
  }, [
    editor,
    getSelectedNode,
    isLinkEditMode,
    linkUrl,
    setFloatingElemPositionForLinkEditor,
    anchorElem,
    setIsLinkEditMode,
  ]);

  useEffect(() => {
    const scrollerElem = anchorElem.parentElement;

    const update = () => {
      editor.getEditorState().read(() => {
        $updateLinkEditor();
      });
    };

    window.addEventListener("resize", update);

    if (scrollerElem) {
      scrollerElem.addEventListener("scroll", update);
    }

    return () => {
      window.removeEventListener("resize", update);

      if (scrollerElem) {
        scrollerElem.removeEventListener("scroll", update);
      }
    };
  }, [anchorElem.parentElement, editor, $updateLinkEditor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateLinkEditor();
        });
      }),

      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          $updateLinkEditor();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (isLink) {
            setIsLink(false);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor, $updateLinkEditor, setIsLink, isLink]);

  useEffect(() => {
    editor.getEditorState().read(() => {
      $updateLinkEditor();
    });
  }, [editor, $updateLinkEditor]);

  useEffect(() => {
    if (isLinkEditMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isLinkEditMode]);

  const monitorInputInteraction = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleLinkSubmission();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsLinkEditMode(false);
    }
  };

  const handleLinkSubmission = () => {
    if (lastSelection !== null) {
      if (linkUrl !== "") {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, sanitizeUrl(editedLinkUrl));
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const parent = getSelectedNode(selection).getParent();
            if ($isAutoLinkNode(parent)) {
              const linkNode = $createLinkNode(parent.getURL(), {
                rel: parent.__rel,
                target: parent.__target,
                title: parent.__title,
              });
              parent.replace(linkNode, true);
            }
          }
        });
      }
      setEditedLinkUrl("https://");
      setIsLinkEditMode(false);
    }
  };

  return (
    <div
      ref={editorRef}
      style={{ willChange: "transform" }}
      className="flex items-center absolute top-0 left-0 z-10 max-w-[400px] w-full opacity-0 bg-transparent  transition-opacity duration-300"
    >
      {!isLink ? null : isLinkEditMode ? (
        <div className="flex items-center w-full justify-between gap-4 p-1 bg-background border border-border rounded-md">
          <Input
            ref={inputRef}
            value={editedLinkUrl}
            className="w-full border border-ring focus-visible:ring-0 py-1 px-2 h-10"
            onChange={(event) => {
              setEditedLinkUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              monitorInputInteraction(event);
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              size="icon"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setIsLinkEditMode(false);
              }}
            >
              <XIcon className="w-4 h-4" />
            </Button>

            <Button
              variant="secondary"
              size="icon"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleLinkSubmission}
            >
              <CheckIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center w-full justify-between gap-4 p-1 bg-background border border-border rounded-md">
          <Button variant="link" asChild rel="noopener noreferrer">
            <Link
              className="text-muted-foreground text-sm text-left justify-start truncate pl-2"
              target="_blank"
              href={sanitizeUrl(linkUrl)}
            >
              {linkUrl}
            </Link>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setEditedLinkUrl(linkUrl);
                setIsLinkEditMode(true);
                setTimeout(() => {
                  if (inputRef.current) {
                    inputRef.current.focus();
                  }
                }, 0);
              }}
            >
              <PencilIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="destructive"
              size="icon"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
              }}
            >
              <TrashIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function useFloatingLinkEditorToolbar(
  editor: LexicalEditor,
  anchorElem: HTMLElement,
  isLinkEditMode: boolean,
  setIsLinkEditMode: Dispatch<boolean>,
): React.JSX.Element | null {
  const [activeEditor, setActiveEditor] = useState(editor);
  const [isLink, setIsLink] = useState(false);
  const getSelectedNode = useGetSelectedNode();

  useEffect(() => {
    function $updateToolbar() {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const focusNode = getSelectedNode(selection);
        const focusLinkNode = $findMatchingParent(focusNode, $isLinkNode);
        const focusAutoLinkNode = $findMatchingParent(
          focusNode,
          $isAutoLinkNode,
        );
        if (!(focusLinkNode || focusAutoLinkNode)) {
          setIsLink(false);
          return;
        }
        const badNode = selection
          .getNodes()
          .filter((node) => !$isLineBreakNode(node))
          .find((node) => {
            const linkNode = $findMatchingParent(node, $isLinkNode);
            const autoLinkNode = $findMatchingParent(node, $isAutoLinkNode);
            return (
              (focusLinkNode && !focusLinkNode.is(linkNode)) ||
              (linkNode && !linkNode.is(focusLinkNode)) ||
              (focusAutoLinkNode && !focusAutoLinkNode.is(autoLinkNode)) ||
              (autoLinkNode && !autoLinkNode.is(focusAutoLinkNode))
            );
          });
        if (!badNode) {
          setIsLink(true);
        } else {
          setIsLink(false);
        }
      }
    }
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_payload, newEditor) => {
          $updateToolbar();
          setActiveEditor(newEditor);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      editor.registerCommand(
        CLICK_COMMAND,
        (payload) => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const node = getSelectedNode(selection);
            const linkNode = $findMatchingParent(node, $isLinkNode);
            if ($isLinkNode(linkNode) && (payload.metaKey || payload.ctrlKey)) {
              window.open(linkNode.getURL(), "_blank");
              return true;
            }
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, getSelectedNode]);

  return createPortal(
    <FloatingLinkEditor
      editor={activeEditor}
      isLink={isLink}
      anchorElem={anchorElem}
      setIsLink={setIsLink}
      isLinkEditMode={isLinkEditMode}
      setIsLinkEditMode={setIsLinkEditMode}
    />,
    anchorElem,
  );
}

export default function FloatingLinkEditorPlugin({
  anchorElem = document.body,
  isLinkEditMode,
  setIsLinkEditMode,
}: {
  anchorElem?: HTMLElement;
  isLinkEditMode: boolean;
  setIsLinkEditMode: Dispatch<boolean>;
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  return useFloatingLinkEditorToolbar(
    editor,
    anchorElem,
    isLinkEditMode,
    setIsLinkEditMode,
  );
}
