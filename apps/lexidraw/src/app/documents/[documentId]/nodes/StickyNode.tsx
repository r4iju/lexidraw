import { StickyNode as HeadlessStickyNode } from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import * as React from "react";
import { Suspense } from "react";
import { createPortal } from "react-dom";

export type {
  SerializedStickyNode,
  StickyNoteColor,
} from "@packages/lexical-nodes";

const StickyComponent = React.lazy(() => import("./StickyComponent"));

/** React half of the package's StickyNode; see ImageNode. */
export class StickyNode extends HeadlessStickyNode {
  static getType = HeadlessStickyNode.getType;
  static clone = HeadlessStickyNode.clone;
  static importJSON = HeadlessStickyNode.importJSON;

  decorate(_editor: LexicalEditor, _config: EditorConfig): React.JSX.Element {
    return createPortal(
      <Suspense fallback={null}>
        <StickyComponent
          color={this.__color}
          x={this.__x}
          y={this.__y}
          nodeKey={this.getKey()}
          caption={this.__caption}
        />
      </Suspense>,
      document.body,
    );
  }
}
