import { PageBreakNode as HeadlessPageBreakNode } from "@packages/lexical-nodes";
import type * as React from "react";
import PageBreakComponent from "./PageBreakComponent";

export type { SerializedPageBreakNode } from "@packages/lexical-nodes";

/** React half of the package's PageBreakNode; see ImageNode. */
export class PageBreakNode extends HeadlessPageBreakNode {
  static getType = HeadlessPageBreakNode.getType;
  static clone = HeadlessPageBreakNode.clone;
  static importJSON = HeadlessPageBreakNode.importJSON;

  decorate(): React.JSX.Element {
    return <PageBreakComponent nodeKey={this.__key} />;
  }
}
