import type {
  EditorState,
  LexicalCommand,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  RangeSelection,
} from "lexical";
import {
  $createMarkNode,
  $getMarkIDs,
  $isMarkNode,
  $unwrapMarkNode,
  $wrapSelectionInMarkNode,
  MarkNode,
} from "@lexical/mark";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { ClearEditorPlugin } from "@lexical/react/LexicalClearEditorPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $dfs,
  mergeRegister,
  registerNestedElementResolver,
} from "@lexical/utils";
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  CLEAR_EDITOR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  getDOMSelection,
  KEY_ESCAPE_COMMAND,
  $setSelection,
} from "lexical";
import React, {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
} from "react";
import { Trash, Send, ChevronRight } from "lucide-react";
import {
  Comment,
  Comments,
  CommentStore,
  Thread,
  useCommentStore,
} from "../../commenting";
import ContentEditable from "~/components/ui/content-editable";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import CommentEditorTheme from "../../themes/CommentEditorTheme";
import useLayoutEffect from "../../shared/useLayoutEffect";
import useModal from "~/hooks/useModal";
import { CommentNode } from "../../nodes/CommentNode";
import { ThreadNode } from "../../nodes/ThreadNode";
import { $rootTextContent } from "@lexical/text";
import { createDOMRange } from "@lexical/selection";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import Ellipsis from "~/components/icons/ellipsis";
import { useUserNameOrGuestName } from "~/hooks/use-user-name-or-guest-name";

export const INSERT_INLINE_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_INLINE_COMMAND",
);

interface CommentPluginContextType {
  commentStore: CommentStore;
  comments: Comments;
  markNodeMap: Map<string, Set<NodeKey>>;
  activeIDs: string[];
  showCommentInput: boolean;
  setShowCommentInput: (show: boolean) => void;
  cancelAddComment: () => void;
  submitAddComment: (
    item: Comment | Thread,
    isInlineComment: boolean,
    parentThread?: Thread,
    sel?: RangeSelection | null,
  ) => void;
  deleteCommentOrThread: (
    thing: Comment | Thread,
    parentThread?: Thread,
  ) => void;
  editor: LexicalEditor;
}

const CommentPluginContext = createContext<CommentPluginContextType | null>(
  null,
);

export const useCommentPlugin = (): CommentPluginContextType => {
  const context = useContext(CommentPluginContext);
  if (context === null) {
    throw new Error(
      "useCommentPlugin must be used within a CommentPluginProvider",
    );
  }
  return context;
};

// PlainTextEditor + EscapeHandler, used in input box
function EscapeHandlerPlugin({
  onEscape,
}: {
  onEscape: (e: KeyboardEvent) => boolean;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event: KeyboardEvent) => onEscape(event),
      2,
    );
  }, [editor, onEscape]);
  return null;
}

function useOnChange(
  setContent: (text: string) => void,
  setCanSubmit: (canSubmit: boolean) => void,
) {
  return useCallback(
    (editorState: EditorState, _editor: LexicalEditor) => {
      editorState.read(() => {
        const content = $rootTextContent();
        setContent(content);
        const isEmpty = content.trim() === "";
        setCanSubmit(!isEmpty);
      });
    },
    [setContent, setCanSubmit],
  );
}

function PlainTextEditor({
  className,
  autoFocus = true,
  onEscape,
  onChange,
  editorRef,
  placeholder = "Type a comment...",
}: {
  className?: string;
  autoFocus?: boolean;
  onEscape: (e: KeyboardEvent) => boolean;
  onChange: (editorState: EditorState, editor: LexicalEditor) => void;
  editorRef?: { current: null | LexicalEditor };
  placeholder?: string;
}) {
  const initialConfig = {
    namespace: "Commenting",
    nodes: [],
    onError: (error: Error) => {
      throw error;
    },
    theme: CommentEditorTheme,
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={cn("relative m-2 rounded-md")}>
        <PlainTextPlugin
          contentEditable={
            <ContentEditable placeholder={placeholder} className={className} />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <OnChangePlugin onChange={onChange} />
        <HistoryPlugin />
        {autoFocus && <AutoFocusPlugin />}
        <EscapeHandlerPlugin onEscape={onEscape} />
        <ClearEditorPlugin />
        {/* If you want to keep a ref to the sub-editor: */}
        {editorRef && <EditorRefPlugin editorRef={editorRef} />}
      </div>
    </LexicalComposer>
  );
}

// the inline input box that appears near a user selection
export function CommentInputBox({
  editor: mainEditor, // Renamed to avoid conflict with sub-editor
  cancelAddComment,
  submitAddComment,
}: {
  editor: LexicalEditor; // This is the main editor instance
  cancelAddComment: () => void;
  submitAddComment: (
    commentOrThread: Comment | Thread,
    isInlineComment: boolean,
    thread?: Thread,
    selection?: RangeSelection | null,
  ) => void;
}) {
  const author = useUserNameOrGuestName();
  const boxRef = useRef<HTMLDivElement>(null);

  const [content, setContent] = useState("");
  const [canSubmit, setCanSubmit] = useState(false);

  // store a copy of the selection
  const selectionRef = useRef<RangeSelection | null>(null);

  // for rendering a highlight or "phantom" box around the selection
  const highlightState = useMemo(
    () => ({
      container: document.createElement("div"),
      elements: [] as HTMLSpanElement[],
    }),
    [],
  );

  // onChange for the sub-editor
  const onChange = useOnChange(setContent, setCanSubmit);

  // Positioning the box near the selection
  const positionBox = useCallback(() => {
    mainEditor.getEditorState().read(() => {
      // Use mainEditor
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;

      // clone it so we can get text content
      selectionRef.current = sel.clone();
      const anchor = sel.anchor;
      const focus = sel.focus;
      const range = createDOMRange(
        mainEditor, // Use mainEditor
        anchor.getNode(),
        anchor.offset,
        focus.getNode(),
        focus.offset,
      );
      const boxElem = boxRef.current;
      if (!range || !boxElem) return;
      const rect = range.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - 125; // 125 = half the box width
      if (left < 10) left = 10;
      const top = rect.bottom + 10 + window.pageYOffset;

      requestAnimationFrame(() => {
        if (!boxRef.current) return;
        boxRef.current.style.left = `${left}px`;
        boxRef.current.style.top = `${top}px`;
      });

      // also highlight selection
      const { container, elements } = highlightState;
      const selectionRects = range.getClientRects();
      const color = "255, 212, 0"; // some highlight color
      for (let i = 0; i < selectionRects.length; i++) {
        const cRect = selectionRects[i];
        if (!elements[i]) {
          const span = document.createElement("span");
          elements[i] = span;
          container.appendChild(span);
        }
        const span = elements[i];
        const style = `position:absolute;top:${
          cRect?.top ?? 0 + window.pageYOffset
        }px;left:${cRect?.left ?? 0}px;height:${cRect?.height ?? 0}px;width:${
          cRect?.width ?? 0
        }px;background-color:rgba(${color},0.3);z-index:9999;pointer-events:none;`;
        if (span) {
          span.style.cssText = style;
        }
      }
      // Remove any extra highlights
      for (let i = selectionRects.length; i < elements.length; i++) {
        const leftover = elements[i];
        leftover?.remove();
        elements.splice(i, 1);
      }
    });
  }, [mainEditor, highlightState]);

  // move or re-calc box on resize
  useLayoutEffect(() => {
    positionBox();
    window.addEventListener("resize", positionBox);
    return () => {
      window.removeEventListener("resize", positionBox);
    };
  }, [positionBox]);

  // insert highlight container
  useLayoutEffect(() => {
    document.body.appendChild(highlightState.container);
    return () => {
      highlightState.container.remove();
    };
  }, [highlightState.container]);

  // pressing Esc
  const onEscape = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      cancelAddComment();
      return true;
    },
    [cancelAddComment],
  );

  const doSubmit = useCallback(() => {
    if (!canSubmit) return;
    let quote = mainEditor.getEditorState().read(() => {
      // Use mainEditor
      const sel = selectionRef.current;
      return sel ? sel.getTextContent() : "";
    });
    if (quote.length > 100) {
      quote = quote.slice(0, 99) + "…";
    }
    const newThread = CommentStore.createThread(quote, [
      CommentStore.createComment(content, author),
    ]);
    submitAddComment(newThread, true, undefined, selectionRef.current || null);
  }, [canSubmit, mainEditor, content, author, submitAddComment]);

  return (
    <div
      data-component-name="CommentInputBox"
      className="fixed w-64 min-h-20 left-0 top-0 bg-muted shadow-lg rounded-md z-20 animate-in slide-in-from-right-5 border border-border"
      ref={boxRef}
    >
      {/* arrow div */}
      <div
        className="
          absolute
          w-0 h-0
          left-1/2
          -top-2
          -translate-x-1/2
          border-l-[8px] border-l-transparent
          border-r-[8px] border-r-transparent
          border-b-[8px] border-b-muted
        "
      />
      <PlainTextEditor
        autoFocus
        className={cn(
          "relative block w-full border border-border bg-background rounded-sm text-sm p-2",
          "focus:outline focus:outline-primary",
        )}
        onEscape={onEscape}
        onChange={onChange}
      />
      <div className="flex gap-2 p-2">
        <Button variant="outline" className="w-full" onClick={cancelAddComment}>
          Cancel
        </Button>
        <Button
          variant="default"
          className="w-full"
          disabled={!canSubmit}
          onClick={doSubmit}
        >
          Comment
        </Button>
      </div>
    </div>
  );
}

// the "composer" inside a thread, to add a new sub-comment
function CommentsComposer({
  submitAddComment,
  thread,
  placeholder = "Reply to comment...",
}: {
  submitAddComment: (
    commentOrThread: Comment,
    isInlineComment: boolean,
    thread?: Thread,
  ) => void;
  thread?: Thread;
  placeholder?: string;
}) {
  const [content, setContent] = useState("");
  const [canSubmit, setCanSubmit] = useState(false);
  const editorRef = useRef<LexicalEditor>(null);
  const author = useUserNameOrGuestName();

  const onChange = useOnChange(setContent, setCanSubmit);
  const doSubmit = useCallback(() => {
    if (!canSubmit) return;
    submitAddComment(
      CommentStore.createComment(content, author),
      false,
      thread,
    );
    // Clear sub-editor
    if (editorRef.current) {
      editorRef.current.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
    }
  }, [canSubmit, content, author, submitAddComment, thread]);

  const onEscape = useCallback(() => {
    // pressing Esc in this sub-editor won't close the UI
    // but we can intercept if we want
    return true;
  }, []);

  return (
    <>
      <PlainTextEditor
        className="block w-full border border-border bg-background rounded-md text-sm p-2"
        autoFocus={false}
        onEscape={onEscape}
        onChange={onChange}
        editorRef={editorRef}
        placeholder={placeholder}
      />
      <Button
        variant="default"
        size="icon"
        className="absolute top-2 right-2"
        onClick={doSubmit}
        disabled={!canSubmit}
      >
        <Send className="size-4" />
      </Button>
    </>
  );
}

// the panel items
function ShowDeleteCommentOrThreadDialog({
  commentOrThread,
  deleteCommentOrThread,
  onClose,
  thread,
}: {
  commentOrThread: Comment | Thread;
  deleteCommentOrThread: (
    commentOrThread: Comment | Thread,
    thread?: Thread,
  ) => void;
  onClose: () => void;
  thread?: Thread;
}) {
  return (
    <>
      <p>Are you sure you want to delete this {commentOrThread.type}?</p>
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            deleteCommentOrThread(
              commentOrThread,
              commentOrThread.type === "thread" ? undefined : thread,
            );
            onClose();
          }}
        >
          Delete
        </Button>
      </div>
    </>
  );
}

function CommentsPanelListComment({
  comment,
  thread,
  deleteComment,
  rtf,
}: {
  comment: Comment;
  thread?: Thread;
  deleteComment: (commentOrThread: Comment | Thread, thread?: Thread) => void;
  rtf: Intl.RelativeTimeFormat;
}) {
  const seconds = Math.round(
    (comment.timeStamp - (performance.timeOrigin + performance.now())) / 1000,
  );
  const minutes = Math.round(seconds / 60);
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;

  const [modal, showModal] = useModal();

  return (
    <li className="py-2 pl-2 pr-2 border-b border-border relative transition-all">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="font-medium">{comment.author}</span>
        <div className="flex items-center gap-2">
          <span>
            · {seconds > -10 ? "Just now" : rtf.format(safeMinutes, "minute")}
          </span>
          {!comment.deleted && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Ellipsis className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    className="flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      showModal("Delete Comment", (onClose) => (
                        <ShowDeleteCommentOrThreadDialog
                          commentOrThread={comment}
                          deleteCommentOrThread={deleteComment}
                          thread={thread}
                          onClose={onClose}
                        />
                      ));
                    }}
                  >
                    <Trash className="size-4" />
                    Delete Comment
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {modal}
            </>
          )}
        </div>
      </div>
      <p className={cn(comment.deleted && "text-muted opacity-60 italic")}>
        {comment.content}
      </p>
    </li>
  );
}

function CommentsPanelList({
  activeIDs,
  comments,
  deleteCommentOrThread,
  submitAddComment,
  markNodeMap,
}: {
  activeIDs: string[];
  comments: Comments;
  deleteCommentOrThread: (
    commentOrThread: Comment | Thread,
    thread?: Thread,
  ) => void;
  submitAddComment: (
    commentOrThread: Comment | Thread,
    isInlineComment: boolean,
    thread?: Thread,
  ) => void;
  markNodeMap: Map<string, Set<NodeKey>>;
}) {
  const [editor] = useLexicalComposerContext();
  const [, setCounter] = useState(0);
  const [modal, showModal] = useModal();

  // For "Just now" -> "1 minute ago" updates every X seconds
  const rtf = useMemo(
    () =>
      new Intl.RelativeTimeFormat("en", {
        style: "short",
        numeric: "auto",
      }),
    [],
  );

  useEffect(() => {
    const timer = setInterval(() => setCounter((c) => c + 1), 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <ul className="list-none w-full overflow-y-auto h-[calc(100%-45px)]">
      {comments.map((commentOrThread) => {
        const nodeId = commentOrThread.id;

        if (commentOrThread.type === "thread") {
          const thread = commentOrThread;
          const isThreadActive = activeIDs.includes(nodeId);

          // Modify deselect function
          const deselect = () => {
            editor.update(() => {
              $setSelection(null); // Explicitly clear the selection
            });
          };

          const handleClickThread = () => {
            // Attempt to place selection on a mark with that ID
            const markKeys = markNodeMap.get(nodeId);
            if (!markKeys) return;

            // Move selection to the start of the first key
            const firstKey = Array.from(markKeys)[0];
            if (!firstKey) return;

            const activeElem = document.activeElement;
            editor.update(
              () => {
                const maybeMark = $getNodeByKey<MarkNode>(firstKey);
                if (maybeMark && $isMarkNode(maybeMark)) {
                  maybeMark.selectStart();
                }
              },
              {
                onUpdate() {
                  if (activeElem instanceof HTMLElement) {
                    activeElem.focus(); // restore focus
                  }
                },
              },
            );
          };

          return (
            <li
              key={nodeId}
              onClick={handleClickThread}
              className={cn(
                "p-0 m-0 border-b border-border relative transition-all duration-100 ease-linear",
                { "ring-1 ring-ring": isThreadActive },
              )}
            >
              <div className="flex items-center py-2 text-muted-foreground gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isThreadActive) {
                      deselect();
                    } else {
                      handleClickThread();
                    }
                  }}
                  className="p-1 size-8"
                >
                  <ChevronRight
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      {
                        "rotate-90": isThreadActive,
                      },
                    )}
                  />
                </Button>
                <div
                  className="flex-1 min-w-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="inline font-semibold leading-tight break-words text-sm line-clamp-2">
                    {commentOrThread.quote}
                  </span>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Ellipsis className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      className="flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        showModal("Delete Thread", (onClose) => (
                          <ShowDeleteCommentOrThreadDialog
                            commentOrThread={commentOrThread}
                            deleteCommentOrThread={deleteCommentOrThread}
                            onClose={onClose}
                            thread={commentOrThread}
                          />
                        ));
                      }}
                    >
                      <Trash className="size-4" />
                      Delete Thread
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {isThreadActive && (
                <div className="pl-6">
                  <ul>
                    {thread.comments.map((cmt) => (
                      <CommentsPanelListComment
                        key={cmt.id}
                        thread={thread}
                        comment={cmt}
                        deleteComment={deleteCommentOrThread}
                        rtf={rtf}
                      />
                    ))}
                  </ul>
                  <div className="relative pt-1 pr-2 pb-2">
                    <CommentsComposer
                      submitAddComment={submitAddComment}
                      thread={thread}
                      placeholder="Reply to thread..."
                    />
                  </div>
                </div>
              )}
            </li>
          );
        } else {
          return (
            <CommentsPanelListComment
              key={nodeId}
              comment={commentOrThread}
              deleteComment={deleteCommentOrThread}
              rtf={rtf}
            />
          );
        }
      })}
      {modal}
    </ul>
  );
}

// the side panel - now exported and frameless
export function CommentsPanel({
  activeIDs,
  comments,
  deleteCommentOrThread,
  submitAddComment,
  markNodeMap,
}: {
  activeIDs: string[];
  comments: Comments;
  deleteCommentOrThread: (
    commentOrThread: Comment | Thread,
    thread?: Thread,
  ) => void;
  submitAddComment: (
    commentOrThread: Comment | Thread,
    isInlineComment: boolean,
    thread?: Thread,
  ) => void;
  markNodeMap: Map<string, Set<NodeKey>>;
}) {
  const isEmpty = comments.length === 0;

  return (
    <>
      {isEmpty ? (
        <div
          data-component-name="CommentsPanel"
          className="text-center text-sm text-muted-foreground pt-8"
        >
          No Comments
        </div>
      ) : (
        <CommentsPanelList
          activeIDs={activeIDs}
          comments={comments}
          deleteCommentOrThread={deleteCommentOrThread}
          submitAddComment={submitAddComment}
          markNodeMap={markNodeMap}
        />
      )}
    </>
  );
}

export function CommentPluginProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const commentStore = useMemo(() => new CommentStore(editor), [editor]);
  const markNodeMap = useMemo<Map<string, Set<NodeKey>>>(() => new Map(), []);
  const comments = useCommentStore(commentStore);
  const [activeIDs, setActiveIDs] = useState<string[]>([]);
  const [showCommentInput, setShowCommentInput] = useState(false);

  const cancelAddComment = useCallback(() => {
    editor.update(() => {
      const sel = $getSelection();
      if (sel) sel.dirty = true; // restore
    });
    setShowCommentInput(false);
  }, [editor]);

  const deleteCommentOrThread = useCallback(
    (thing: Comment | Thread, parentThread?: Thread) => {
      commentStore.deleteCommentOrThread(thing, parentThread);
      // console.log("info about to be deleted", info); // Original console.log removed for brevity

      if (thing.type === "comment") {
        const commentId = thing.id;
        editor.update(() => {
          const root = $getRoot();
          const dfsNodes = $dfs(root);
          for (const { node } of dfsNodes) {
            if (
              CommentNode.$isCommentNode(node) &&
              node.__comment.id === commentId
            ) {
              node.remove();
            }
          }
        });
      } else {
        const threadId = thing.id;
        editor.update(() => {
          const root = $getRoot();
          const dfsNodes = $dfs(root);
          for (const { node } of dfsNodes) {
            if (
              ThreadNode.$isThreadNode(node) &&
              node.__thread.id === threadId
            ) {
              node.remove();
            }
          }
        });
      }

      const markNodeKeys = markNodeMap.get(thing.id);
      if (markNodeKeys) {
        setTimeout(() => {
          editor.update(() => {
            for (const key of markNodeKeys) {
              const maybeMark = $getNodeByKey<MarkNode>(key);
              if (maybeMark && $isMarkNode(maybeMark)) {
                maybeMark.deleteID(thing.id);
                if (maybeMark.getIDs().length === 0) {
                  $unwrapMarkNode(maybeMark);
                }
              }
            }
          });
        }, 0);
      }
    },
    [commentStore, markNodeMap, editor],
  );

  const submitAddComment = useCallback(
    (
      item: Comment | Thread,
      isInlineComment: boolean,
      parentThread?: Thread,
      sel?: RangeSelection | null,
    ) => {
      commentStore.addComment(item, parentThread);
      editor.update(() => {
        if (item.type === "thread") {
          const threadItem = item as Thread;
          const threadNode = new ThreadNode(threadItem);
          $getRoot().append(threadNode);
          threadItem.comments.forEach((cmt: Comment) => {
            const cnode = new CommentNode(cmt);
            threadNode.append(cnode);
          });
        } else if (item.type === "comment") {
          const commentNode = new CommentNode(item);
          if (parentThread) {
            const root = $getRoot();
            const allNodes = $dfs(root);
            for (const { node: maybeThread } of allNodes) {
              if (
                ThreadNode.$isThreadNode(maybeThread) &&
                maybeThread.__thread.id === parentThread.id
              ) {
                maybeThread.append(commentNode);
                break;
              }
            }
          } else {
            $getRoot().append(commentNode);
          }
        }
      });

      if (isInlineComment && sel) {
        editor.update(() => {
          if ($isRangeSelection(sel)) {
            const backwards = sel.isBackward();
            const id = item.id;
            $wrapSelectionInMarkNode(sel, backwards, id);
          }
        });
        setShowCommentInput(false);
      }
    },
    [commentStore, editor],
  );

  useEffect(() => {
    const markKeysToIDs = new Map<NodeKey, string[]>();
    return mergeRegister(
      registerNestedElementResolver<MarkNode>(
        editor,
        MarkNode,
        (from) => $createMarkNode(from.getIDs()),
        (from, to) => {
          from.getIDs().forEach((id) => to.addID(id));
        },
      ),
      editor.registerMutationListener(MarkNode, (records) => {
        editor.getEditorState().read(() => {
          for (const [key, type] of records) {
            const node = $getNodeByKey<MarkNode>(key);
            let ids: string[] = [];
            if (type === "destroyed") {
              ids = markKeysToIDs.get(key) || [];
            } else if (node && $isMarkNode(node)) {
              ids = node.getIDs();
            }
            for (const id of ids) {
              let setOfKeys = markNodeMap.get(id);
              markKeysToIDs.set(key, ids);

              if (type === "destroyed") {
                if (setOfKeys) {
                  setOfKeys.delete(key);
                  if (setOfKeys.size === 0) {
                    markNodeMap.delete(id);
                  }
                }
              } else {
                if (!setOfKeys) {
                  setOfKeys = new Set();
                  markNodeMap.set(id, setOfKeys);
                }
                if (!setOfKeys.has(key)) {
                  setOfKeys.add(key);
                }
              }
            }
          }
        });
      }),
      editor.registerUpdateListener(({ editorState, tags }) => {
        editorState.read(() => {
          const sel = $getSelection();
          let foundAny = false;
          if ($isRangeSelection(sel)) {
            const anchorNode = sel.anchor.getNode();
            if ($isTextNode(anchorNode)) {
              const maybeIDs = $getMarkIDs(anchorNode, sel.anchor.offset);
              if (maybeIDs) {
                foundAny = true;
                setActiveIDs(maybeIDs);
              }
            }
          }
          if (!foundAny) {
            setActiveIDs((prev) => (prev.length ? [] : prev));
          }
          if (!tags.has("collaboration") && $isRangeSelection(sel)) {
            setShowCommentInput(false);
          }
        });
      }),
      editor.registerCommand(
        INSERT_INLINE_COMMAND,
        () => {
          const domSel = getDOMSelection(editor._window);
          if (domSel) domSel.removeAllRanges();
          setShowCommentInput(true);
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    );
  }, [editor, markNodeMap]);

  useEffect(() => {
    editor.getEditorState().read(() => {
      const knownIds = new Set(
        commentStore
          .getComments()
          .flatMap((x) =>
            x.type === "thread"
              ? [x.id, ...x.comments.map((c) => c.id)]
              : [x.id],
          ),
      );
      const root = $getRoot();
      const allNodes = $dfs(root);
      for (const { node } of allNodes) {
        if (CommentNode.$isCommentNode(node) && !knownIds.has(node.__comment.id)) {
          commentStore.addComment(node.__comment);
          knownIds.add(node.__comment.id);
        } else if (
          ThreadNode.$isThreadNode(node) &&
          !knownIds.has(node.__thread.id)
        ) {
          const thr = node.__thread;
          // Ensure all comments within the thread are also processed
          commentStore.addComment(thr); // Add thread first
          knownIds.add(thr.id);
          thr.comments.forEach((cmt) => {
            if (!knownIds.has(cmt.id)) {
              commentStore.addComment(cmt, thr); // Then add comments belonging to this thread
              knownIds.add(cmt.id);
            }
          });
        }
      }
    });
  }, [editor, commentStore]);

  return (
    <CommentPluginContext.Provider
      value={
        {
          commentStore,
          comments,
          markNodeMap,
          activeIDs,
          showCommentInput,
          setShowCommentInput,
          cancelAddComment,
          submitAddComment,
          deleteCommentOrThread,
          editor,
        } satisfies CommentPluginContextType
      }
    >
      {children}
    </CommentPluginContext.Provider>
  );
}

export function CommentUI(): JSX.Element {
  const {
    activeIDs,
    deleteCommentOrThread,
    comments,
    markNodeMap,
    submitAddComment,
  } = useCommentPlugin();

  return (
    <div className="h-full p-2" data-component-name="CommentUI">
      <CommentsPanel
        activeIDs={activeIDs}
        deleteCommentOrThread={deleteCommentOrThread}
        comments={comments}
        submitAddComment={submitAddComment}
        markNodeMap={markNodeMap}
      />
    </div>
  );
}

// Default export is CommentPluginProvider
export default CommentPluginProvider;
