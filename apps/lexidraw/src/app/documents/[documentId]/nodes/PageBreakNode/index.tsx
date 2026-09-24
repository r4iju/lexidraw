import { PageBreakNode as HeadlessPageBreakNode } from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "../common/BlockLoading";

export type { SerializedPageBreakNode } from "@packages/lexical-nodes";

const PageBreakComponent = React.lazy(() => import("./PageBreakComponent"));

/** React half of the package's PageBreakNode; see ImageNode. */
export class PageBreakNode extends HeadlessPageBreakNode {
  static getType = HeadlessPageBreakNode.getType;
  static clone = HeadlessPageBreakNode.clone;
  static importJSON = HeadlessPageBreakNode.importJSON;

  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={<BlockLoading />}>
        <PageBreakComponent nodeKey={this.__key} />
      </Suspense>
    );
  }
}
