import { PageBreakNode as HeadlessPageBreakNode } from "@packages/lexical-nodes";
import type * as React from "react";
import PageBreakComponent from "./PageBreakComponent";

export type { SerializedPageBreakNode } from "@packages/lexical-nodes";

/** React half of the package's PageBreakNode; see ImageNode. */
export class PageBreakNode extends HeadlessPageBreakNode {
  $config() {
    return this.config("page-break", { extends: HeadlessPageBreakNode });
  }

  decorate(): React.JSX.Element {
    return <PageBreakComponent nodeKey={this.__key} />;
  }
}
