import type { LexicalEditor } from "lexical";
import { useEffect, useState } from "react";

export type Comment = {
  author: string;
  content: string;
  deleted: boolean;
  id: string;
  timeStamp: number;
  type: "comment";
};

export type Thread = {
  comments: Comment[];
  id: string;
  quote: string;
  type: "thread";
};

export type Comments = (Thread | Comment)[];

export class CommentStore {
  _editor: LexicalEditor;
  _comments: Comments;
  _changeListeners: Set<() => void>;

  constructor(editor: LexicalEditor) {
    this._comments = [];
    this._editor = editor;
    this._changeListeners = new Set();
  }

  getComments(): Comments {
    return this._comments;
  }

  addComment(
    commentOrThread: Comment | Thread,
    thread?: Thread,
    offset?: number,
  ): void {
    const nextComments = Array.from(this._comments);

    if (thread !== undefined && commentOrThread.type === "comment") {
      for (let i = 0; i < nextComments.length; i++) {
        const comment = nextComments[i];
        if (comment?.type === "thread" && comment.id === thread.id) {
          const newThread = CommentStore.cloneThread(comment);
          nextComments.splice(i, 1, newThread);
          const insertOffset =
            offset !== undefined ? offset : newThread.comments.length;
          newThread.comments.splice(insertOffset, 0, commentOrThread);
          break;
        }
      }
    } else {
      const insertOffset = offset !== undefined ? offset : nextComments.length;
      nextComments.splice(insertOffset, 0, commentOrThread);
    }
    this._comments = nextComments;
    CommentStore.triggerOnChange(this);
  }

  deleteCommentOrThread(
    commentOrThread: Comment | Thread,
    thread?: Thread,
  ): { markedComment: Comment; index: number } | null {
    const nextComments = Array.from(this._comments);

    let commentIndex: number | null = null;

    if (thread !== undefined) {
      for (let i = 0; i < nextComments.length; i++) {
        const nextComment = nextComments[i];
        if (nextComment?.type === "thread" && nextComment.id === thread.id) {
          const newThread = CommentStore.cloneThread(nextComment);
          nextComments.splice(i, 1, newThread);
          const threadComments = newThread.comments;
          commentIndex = threadComments.indexOf(commentOrThread as Comment);
          threadComments.splice(commentIndex, 1);
          break;
        }
      }
    } else {
      commentIndex = nextComments.indexOf(commentOrThread);
      nextComments.splice(commentIndex, 1);
    }
    this._comments = nextComments;
    CommentStore.triggerOnChange(this);

    if (commentOrThread.type === "comment") {
      return {
        index: commentIndex as number,
        markedComment: CommentStore.markDeleted(commentOrThread as Comment),
      };
    }

    return null;
  }

  registerOnChange(onChange: () => void): () => void {
    const changeListeners = this._changeListeners;
    changeListeners.add(onChange);
    return () => {
      changeListeners.delete(onChange);
    };
  }

  _createCollabSharedMap(
    commentOrThread: Comment | Thread,
  ): Map<string, unknown> {
    const sharedMap = new Map();
    const type = commentOrThread.type;
    const id = commentOrThread.id;
    sharedMap.set("type", type);
    sharedMap.set("id", id);
    if (type === "comment") {
      sharedMap.set("author", commentOrThread.author);
      sharedMap.set("content", commentOrThread.content);
      sharedMap.set("deleted", commentOrThread.deleted);
      sharedMap.set("timeStamp", commentOrThread.timeStamp);
    } else {
      sharedMap.set("quote", commentOrThread.quote);
      const commentsArray: Map<string, unknown>[] = [];
      for (const comment of commentOrThread.comments) {
        const sharedChildComment = this._createCollabSharedMap(comment);
        commentsArray.push(sharedChildComment);
      }
      sharedMap.set("comments", commentsArray);
    }
    return sharedMap;
  }

  static createUID(): string {
    return Math.random()
      .toString(36)
      .replace(/[^a-z]+/g, "")
      .substring(0, 5);
  }

  static createComment(
    content: string,
    author: string,
    id?: string,
    timeStamp?: number,
    deleted?: boolean,
  ): Comment {
    return {
      author,
      content,
      deleted: deleted === undefined ? false : deleted,
      id: id === undefined ? CommentStore.createUID() : id,
      timeStamp:
        timeStamp === undefined
          ? performance.timeOrigin + performance.now()
          : timeStamp,
      type: "comment",
    };
  }

  static createThread(quote: string, comments: Comment[], id?: string): Thread {
    return {
      comments,
      id: id === undefined ? CommentStore.createUID() : id,
      quote,
      type: "thread",
    };
  }

  static cloneThread(thread: Thread): Thread {
    return {
      comments: Array.from(thread.comments),
      id: thread.id,
      quote: thread.quote,
      type: "thread",
    };
  }

  static markDeleted(comment: Comment): Comment {
    return {
      author: comment.author,
      content: "[Deleted Comment]",
      deleted: true,
      id: comment.id,
      timeStamp: comment.timeStamp,
      type: "comment",
    };
  }

  static triggerOnChange(commentStore: CommentStore): void {
    const listeners = commentStore._changeListeners;
    for (const listener of listeners) {
      listener();
    }
  }
}

export function useCommentStore(commentStore: CommentStore): Comments {
  const [comments, setComments] = useState<Comments>(
    commentStore.getComments(),
  );

  useEffect(() => {
    return commentStore.registerOnChange(() => {
      setComments(commentStore.getComments());
    });
  }, [commentStore]);

  return comments;
}
