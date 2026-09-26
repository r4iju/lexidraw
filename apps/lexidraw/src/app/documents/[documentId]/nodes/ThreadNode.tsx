import { ThreadNode as HeadlessThreadNode } from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import type { JSX } from "react";

export type { SerializedThreadNode } from "@packages/lexical-nodes";

/** React half of the package's ThreadNode; see ImageNode. */
export class ThreadNode extends HeadlessThreadNode {
  $config() {
    return this.config("thread", { extends: HeadlessThreadNode });
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    // could be a small placeholder instead
    return <div className="hidden" />;
  }
}
