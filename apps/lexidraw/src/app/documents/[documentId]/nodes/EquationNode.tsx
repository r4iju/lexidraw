import { EquationNode as HeadlessEquationNode } from "@packages/lexical-nodes";
import type { DOMExportOutput } from "lexical";
import type * as React from "react";
import { Suspense } from "react";
import { katexOptions, loadedKatex } from "~/lib/katex";
import EquationComponent from "./EquationComponent";

export type { SerializedEquationNode } from "@packages/lexical-nodes";

/** React half of the package's EquationNode; see ImageNode. */
export class EquationNode extends HeadlessEquationNode {
  static getType = HeadlessEquationNode.getType;
  static clone = HeadlessEquationNode.clone;
  static importJSON = HeadlessEquationNode.importJSON;

  exportDOM(): DOMExportOutput {
    const output = super.exportDOM();
    // By the time anything is copied or exported, the equations on screen
    // have loaded KaTeX; before then the source stands in.
    loadedKatex()?.render(
      this.__equation,
      output.element as HTMLElement,
      katexOptions(this.__inline),
    );
    return output;
  }

  decorate(): React.JSX.Element {
    return (
      // Only while KaTeX is still on its way; see `blocksReady`.
      <Suspense fallback={<span aria-busy="true" />}>
        <EquationComponent
          equation={this.__equation}
          inline={this.__inline}
          nodeKey={this.__key}
        />
      </Suspense>
    );
  }
}
