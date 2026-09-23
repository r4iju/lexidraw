import { CommentNode as HeadlessCommentNode } from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import type { JSX } from "react";

export type { SerializedCommentNode } from "@packages/lexical-nodes";

/** React half of the package's CommentNode; see ImageNode. */
export class CommentNode extends HeadlessCommentNode {
  static getType = HeadlessCommentNode.getType;
  static clone = HeadlessCommentNode.clone;
  static importJSON = HeadlessCommentNode.importJSON;

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    // hidden since side panel does the heavy-lifting
    return <div className="hidden" />;
  }
}
