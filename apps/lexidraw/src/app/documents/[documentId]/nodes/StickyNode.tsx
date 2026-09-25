import { StickyNode as HeadlessStickyNode } from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import type * as React from "react";
import StickyComponent from "./StickyComponent";

export type {
  SerializedStickyNode,
  StickyNoteColor,
} from "@packages/lexical-nodes";

/** React half of the package's StickyNode; see ImageNode. */
export class StickyNode extends HeadlessStickyNode {
  static getType = HeadlessStickyNode.getType;
  static clone = HeadlessStickyNode.clone;
  static importJSON = HeadlessStickyNode.importJSON;

  decorate(_editor: LexicalEditor, _config: EditorConfig): React.JSX.Element {
    return (
      <StickyComponent
        color={this.__color}
        x={this.__x}
        y={this.__y}
        nodeKey={this.getKey()}
        caption={this.__caption}
      />
    );
  }
}
