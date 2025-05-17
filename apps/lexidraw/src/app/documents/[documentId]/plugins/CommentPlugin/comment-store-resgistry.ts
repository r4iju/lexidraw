// comment-store-registry.ts
import type { LexicalEditor } from "lexical";
import { CommentStore } from "../../commenting";

const registry = new WeakMap<LexicalEditor, CommentStore>();

export const setCommentStore = (editor: LexicalEditor, store: CommentStore) =>
  registry.set(editor, store);

export const getCommentStore = (
  editor: LexicalEditor,
): CommentStore | undefined => registry.get(editor);

export const clearCommentStore = (editor: LexicalEditor) =>
  registry.delete(editor);
