import type {
  EditorState,
  LexicalCommand,
  LexicalEditor,
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
import {
  CircleCheck,
  Ellipsis,
  EllipsisVertical,
  MessageSquareText,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  type Comment,
  type Comments,
  CommentStore,
  type Thread,
  useCommentStore,
} from "../../commenting";
import ContentEditable from "~/components/ui/content-editable";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
  resolveThread: (thread: Thread, resolved: boolean) => void;
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
  placeholder,
}: {
  className?: string;
  autoFocus?: boolean;
  onEscape: (e: KeyboardEvent) => boolean;
  onChange: (editorState: EditorState, editor: LexicalEditor) => void;
  editorRef?: { current: null | LexicalEditor };
  placeholder: string;
}) {
  const initialConfig = {
    namespace: "Commenting",
    nodes: [],
    onError: (error: Error) => {
      throw error;
    },
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              placeholder={placeholder}
              className={cn(
                "relative w-full border border-border bg-background rounded-sm p-2 min-h-10 overflow-y-auto",
                "focus:ring-2 focus:ring-primary",
                className,
              )}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <OnChangePlugin onChange={onChange} />
      <HistoryPlugin />
      {autoFocus && <AutoFocusPlugin />}
      <EscapeHandlerPlugin onEscape={onEscape} />
      <ClearEditorPlugin />
      {/* If you want to keep a ref to the sub-editor: */}
      {editorRef && <EditorRefPlugin editorRef={editorRef} />}
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
      // The box and the highlight sit on the page, so they scroll with it.
      const rect = range.getBoundingClientRect();
      const width = boxElem.offsetWidth;
      const left =
        Math.max(
          8,
          Math.min(
            rect.left + rect.width / 2 - width / 2,
            window.innerWidth - width - 8,
          ),
        ) + window.scrollX;
      const top = rect.bottom + 10 + window.scrollY;

      requestAnimationFrame(() => {
        if (!boxRef.current) return;
        boxRef.current.style.left = `${left}px`;
        boxRef.current.style.top = `${top}px`;
      });

      // also highlight selection
      const { container, elements } = highlightState;
      const selectionRects = range.getClientRects();
      for (let i = 0; i < selectionRects.length; i++) {
        const cRect = selectionRects[i];
        if (!elements[i]) {
          const span = document.createElement("span");
          elements[i] = span;
          container.appendChild(span);
        }
        const span = elements[i];
        const style = `position:absolute;top:${
          (cRect?.top ?? 0) + window.scrollY
        }px;left:${(cRect?.left ?? 0) + window.scrollX}px;height:${cRect?.height ?? 0}px;width:${
          cRect?.width ?? 0
        }px;background-color:var(--comment-mark);border-bottom:2px solid var(--comment-border);z-index:9999;pointer-events:none;`;
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
      quote = `${quote.slice(0, 99)}…`;
    }
    const newThread = CommentStore.createThread(quote, [
      CommentStore.createComment(content, author),
    ]);
    submitAddComment(newThread, true, undefined, selectionRef.current || null);
  }, [canSubmit, mainEditor, content, author, submitAddComment]);

  return createPortal(
    <div
      data-component-name="CommentInputBox"
      className="absolute w-64 min-h-20 left-0 top-0 elevation-overlay rounded-lg z-20 animate-in slide-in-from-right-5"
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
      <div className="p-2">
        <PlainTextEditor
          autoFocus
          onEscape={onEscape}
          onChange={onChange}
          placeholder="Type a comment..."
        />
      </div>
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
    </div>,
    document.body,
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
    <div className="relative flex flex-row py-2 gap-2 w-full items-center">
      <div className="flex-1 w-full">
        <PlainTextEditor
          autoFocus={false}
          onEscape={onEscape}
          onChange={onChange}
          editorRef={editorRef}
          placeholder={placeholder}
        />
      </div>
      <Button
        variant="default"
        size="icon"
        className=" top-2 right-2"
        onClick={doSubmit}
        disabled={!canSubmit}
      >
        <Send className="size-4" />
        <span className="sr-only">Send reply</span>
      </Button>
    </div>
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
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive-confirm"
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
      </DialogFooter>
    </>
  );
}

/** When a comment was written, as a reader counts it. */
function commentTime(
  timeStamp: number,
  now: number,
  rtf: Intl.RelativeTimeFormat,
): string {
  const minutes = Math.round((timeStamp - now) / 60_000);
  if (minutes > -1) return "Just now";
  if (minutes > -60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (days > -7) return rtf.format(days, "day");
  return new Date(timeStamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type PanelActions = {
  deleteCommentOrThread: (
    commentOrThread: Comment | Thread,
    thread?: Thread,
  ) => void;
  submitAddComment: (
    commentOrThread: Comment | Thread,
    isInlineComment: boolean,
    thread?: Thread,
  ) => void;
  resolveThread: (thread: Thread, resolved: boolean) => void;
};

function CommentsPanelListComment({
  comment,
  thread,
  deleteComment,
  now,
  rtf,
}: {
  comment: Comment;
  thread?: Thread;
  deleteComment: PanelActions["deleteCommentOrThread"];
  now: number;
  rtf: Intl.RelativeTimeFormat;
}) {
  const [modal, showModal] = useModal();

  return (
    <li className="flex flex-col gap-0.5 py-2">
      <div className="flex min-h-7 items-center gap-2 text-xs">
        <span className="truncate font-medium text-foreground">
          {comment.author}
        </span>
        <time
          className="shrink-0 text-muted-foreground"
          dateTime={new Date(comment.timeStamp).toISOString()}
        >
          {commentTime(comment.timeStamp, now, rtf)}
        </time>
        {!comment.deleted && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7 text-muted-foreground"
              >
                <EllipsisVertical className="size-3.5" />
                <span className="sr-only">
                  {`Actions for the comment by ${comment.author}`}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={() => {
                  showModal("Delete comment", (onClose) => (
                    <ShowDeleteCommentOrThreadDialog
                      commentOrThread={comment}
                      deleteCommentOrThread={deleteComment}
                      thread={thread}
                      onClose={onClose}
                    />
                  ));
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <p
        className={cn(
          "whitespace-pre-wrap break-words text-sm",
          comment.deleted && "italic text-muted-foreground",
        )}
      >
        {comment.content}
      </p>
      {modal}
    </li>
  );
}

function CommentsPanelThread({
  thread,
  active,
  onShow,
  actions,
  now,
  rtf,
}: {
  thread: Thread;
  active: boolean;
  onShow: () => void;
  actions: PanelActions;
  now: number;
  rtf: Intl.RelativeTimeFormat;
}) {
  const [modal, showModal] = useModal();

  return (
    <li>
      <article
        aria-label={`Comments on “${thread.quote}”`}
        className={cn(
          "rounded-lg bg-background px-3 pt-2 pb-1 transition-colors",
          active ? "border border-comment-border" : "border border-border",
        )}
      >
        <header className="flex items-start gap-1">
          <button
            type="button"
            onClick={onShow}
            title="Show in the document"
            className="my-1 min-w-0 flex-1 border-l-2 border-comment-border pl-2 text-left text-xs text-muted-foreground line-clamp-2 break-words hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
          >
            {thread.quote}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 shrink-0">
                <Ellipsis className="size-4" />
                <span className="sr-only">Thread actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => actions.resolveThread(thread, !thread.resolved)}
              >
                {thread.resolved ? (
                  <RotateCcw className="size-4" />
                ) : (
                  <CircleCheck className="size-4" />
                )}
                {thread.resolved ? "Reopen" : "Resolve"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={() => {
                  showModal("Delete thread", (onClose) => (
                    <ShowDeleteCommentOrThreadDialog
                      commentOrThread={thread}
                      deleteCommentOrThread={actions.deleteCommentOrThread}
                      onClose={onClose}
                      thread={thread}
                    />
                  ));
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <ul className="divide-y divide-border">
          {thread.comments.map((cmt) => (
            <CommentsPanelListComment
              key={cmt.id}
              thread={thread}
              comment={cmt}
              deleteComment={actions.deleteCommentOrThread}
              now={now}
              rtf={rtf}
            />
          ))}
        </ul>
        {!thread.resolved && (
          <CommentsComposer
            submitAddComment={actions.submitAddComment}
            thread={thread}
            placeholder="Reply…"
          />
        )}
      </article>
      {modal}
    </li>
  );
}

function CommentsPanelList({
  activeIDs,
  comments,
  markNodeMap,
  actions,
}: {
  activeIDs: string[];
  comments: Comments;
  markNodeMap: Map<string, Set<NodeKey>>;
  actions: PanelActions;
}) {
  const [editor] = useLexicalComposerContext();
  const [now, setNow] = useState(() => Date.now());

  const rtf = useMemo(
    () =>
      new Intl.RelativeTimeFormat("en", {
        style: "short",
        numeric: "auto",
      }),
    [],
  );

  // External system: the clock, so "Just now" ages.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const showThread = (id: string) => {
    const firstKey = markNodeMap.get(id)?.values().next().value;
    if (!firstKey) return;
    const activeElem = document.activeElement;
    editor.update(
      () => {
        const maybeMark = $getNodeByKey<MarkNode>(firstKey);
        if (maybeMark && $isMarkNode(maybeMark)) maybeMark.selectStart();
      },
      {
        onUpdate() {
          if (activeElem instanceof HTMLElement) activeElem.focus();
          editor.getElementByKey(firstKey)?.scrollIntoView({
            block: "center",
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          });
        },
      },
    );
  };

  const open = comments.filter(
    (item) => item.type !== "thread" || !item.resolved,
  );
  const resolved = comments.filter(
    (item): item is Thread => item.type === "thread" && Boolean(item.resolved),
  );
  const render = (item: Thread | Comment) =>
    item.type === "thread" ? (
      <CommentsPanelThread
        key={item.id}
        thread={item}
        active={activeIDs.includes(item.id)}
        onShow={() => showThread(item.id)}
        actions={actions}
        now={now}
        rtf={rtf}
      />
    ) : (
      <CommentsPanelListComment
        key={item.id}
        comment={item}
        deleteComment={actions.deleteCommentOrThread}
        now={now}
        rtf={rtf}
      />
    );

  return (
    <div className="flex flex-col gap-3 p-3">
      <ul className="flex list-none flex-col gap-3">{open.map(render)}</ul>
      {resolved.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none rounded-sm px-1 py-1.5 text-xs font-medium text-muted-foreground">
            Resolved ({resolved.length})
          </summary>
          <ul className="mt-2 flex list-none flex-col gap-3 opacity-80">
            {resolved.map(render)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function CommentsPanel({
  activeIDs,
  comments,
  markNodeMap,
  actions,
}: {
  activeIDs: string[];
  comments: Comments;
  markNodeMap: Map<string, Set<NodeKey>>;
  actions: PanelActions;
}) {
  if (comments.length === 0) {
    return (
      <div
        data-component-name="CommentsPanel"
        className="flex flex-col items-center gap-3 px-6 pt-10 text-center text-sm text-muted-foreground"
      >
        <MessageSquareText className="size-6" aria-hidden />
        <p className="text-balance">
          Select text and press the comment button{" "}
          <MessageSquareText
            className="inline size-4 align-text-bottom"
            aria-hidden
          />{" "}
          to start a thread.
        </p>
      </div>
    );
  }
  return (
    <CommentsPanelList
      activeIDs={activeIDs}
      comments={comments}
      markNodeMap={markNodeMap}
      actions={actions}
    />
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

  /** Writes the store's copy of a thread into its node, so it saves. */
  const $saveThread = useCallback(
    (id: string) => {
      const thread = commentStore
        .getComments()
        .find(
          (item): item is Thread => item.type === "thread" && item.id === id,
        );
      for (const { node } of $dfs($getRoot())) {
        if (ThreadNode.$isThreadNode(node) && node.getThread().id === id) {
          if (thread) node.setThread(thread);
          else node.remove();
        }
      }
    },
    [commentStore],
  );

  const deleteCommentOrThread = useCallback(
    (thing: Comment | Thread, parentThread?: Thread) => {
      commentStore.deleteCommentOrThread(thing, parentThread);
      editor.update(() => {
        if (parentThread) {
          $saveThread(parentThread.id);
          return;
        }
        for (const { node } of $dfs($getRoot())) {
          if (
            (CommentNode.$isCommentNode(node) &&
              node.__comment.id === thing.id) ||
            (ThreadNode.$isThreadNode(node) && node.getThread().id === thing.id)
          ) {
            node.remove();
          }
        }
      });

      const markNodeKeys = thing.type === "thread" && markNodeMap.get(thing.id);
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
    [commentStore, markNodeMap, editor, $saveThread],
  );

  const resolveThread = useCallback(
    (thread: Thread, resolved: boolean) => {
      commentStore.updateThread({ ...thread, resolved });
      editor.update(() => $saveThread(thread.id));
    },
    [commentStore, editor, $saveThread],
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
          $getRoot().append(new ThreadNode(item));
        } else if (parentThread) {
          $saveThread(parentThread.id);
        } else {
          $getRoot().append(new CommentNode(item));
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
    [commentStore, editor, $saveThread],
  );

  // External system: the range elements Lexical renders. The thread in focus
  // reads stronger, and a settled thread's range reads as plain text.
  useEffect(() => {
    const resolved = new Set(
      comments.flatMap((item) =>
        item.type === "thread" && item.resolved ? [item.id] : [],
      ),
    );
    const paint = () => {
      const idsByKey = new Map<NodeKey, string[]>();
      for (const [id, keys] of markNodeMap) {
        for (const key of keys)
          idsByKey.set(key, [...(idsByKey.get(key) ?? []), id]);
      }
      for (const [key, ids] of idsByKey) {
        const element = editor.getElementByKey(key);
        if (!element) continue;
        if (ids.some((id) => activeIDs.includes(id)))
          element.dataset.comment = "active";
        else if (ids.every((id) => resolved.has(id)))
          element.dataset.comment = "resolved";
        else delete element.dataset.comment;
      }
    };
    paint();
    return editor.registerMutationListener(MarkNode, paint, {
      skipInitialization: true,
    });
  }, [editor, comments, activeIDs, markNodeMap]);

  useEffect(() => {
    const markKeysToIDs = new Map<NodeKey, string[]>();
    return mergeRegister(
      registerNestedElementResolver<MarkNode>(
        editor,
        MarkNode,
        (from) => $createMarkNode(from.getIDs()),
        (from, to) => {
          for (const id of from.getIDs()) {
            to.addID(id);
          }
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
      for (const { node } of $dfs($getRoot())) {
        if (CommentNode.$isCommentNode(node)) {
          commentStore.addComment(node.__comment);
        } else if (ThreadNode.$isThreadNode(node)) {
          // A stored thread carries its comments.
          commentStore.addComment(node.__thread);
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
          resolveThread,
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
    resolveThread,
  } = useCommentPlugin();
  const actions = useMemo(
    () => ({ deleteCommentOrThread, submitAddComment, resolveThread }),
    [deleteCommentOrThread, submitAddComment, resolveThread],
  );

  return (
    <div data-component-name="CommentUI">
      <CommentsPanel
        activeIDs={activeIDs}
        comments={comments}
        markNodeMap={markNodeMap}
        actions={actions}
      />
    </div>
  );
}

// Default export is CommentPluginProvider
export default CommentPluginProvider;
