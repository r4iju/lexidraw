import type { LexicalEditor, NodeKey } from "lexical";
import { CommentStore, type Comment, type Thread } from "../../commenting";

const commentStoreRegistry = new WeakMap<LexicalEditor, CommentStore>();
const commentDeleteFuncRegistry = new WeakMap<
  LexicalEditor,
  (thing: Comment | Thread, parentThread?: Thread) => void
>();
const markNodeMapRegistry = new WeakMap<
  LexicalEditor,
  Map<string, Set<NodeKey>>
>();

export const setCommentStore = (editor: LexicalEditor, store: CommentStore) =>
  commentStoreRegistry.set(editor, store);

export const getCommentStore = (
  editor: LexicalEditor,
): CommentStore | undefined => commentStoreRegistry.get(editor);

export const clearCommentStore = (editor: LexicalEditor) =>
  commentStoreRegistry.delete(editor);

export const setCommentDeleteFunc = (
  editor: LexicalEditor,
  deleteFunc: (thing: Comment | Thread, parentThread?: Thread) => void,
) => commentDeleteFuncRegistry.set(editor, deleteFunc);

export const getCommentDeleteFunc = (
  editor: LexicalEditor,
): ((thing: Comment | Thread, parentThread?: Thread) => void) | undefined =>
  commentDeleteFuncRegistry.get(editor);

export const clearCommentDeleteFunc = (editor: LexicalEditor) =>
  commentDeleteFuncRegistry.delete(editor);

export const setMarkNodeMap = (
  editor: LexicalEditor,
  map: Map<string, Set<NodeKey>>,
) => markNodeMapRegistry.set(editor, map);

export const clearMarkNodeMap = (editor: LexicalEditor) =>
  markNodeMapRegistry.delete(editor);
