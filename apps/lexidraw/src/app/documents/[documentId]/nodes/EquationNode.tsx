import { EquationNode as HeadlessEquationNode } from "@packages/lexical-nodes";
import katex from "katex";
import type { DOMExportOutput } from "lexical";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "./common/BlockLoading";

export type { SerializedEquationNode } from "@packages/lexical-nodes";

const EquationComponent = React.lazy(() => import("./EquationComponent"));

/** React half of the package's EquationNode; see ImageNode. */
export class EquationNode extends HeadlessEquationNode {
  static getType = HeadlessEquationNode.getType;
  static clone = HeadlessEquationNode.clone;
  static importJSON = HeadlessEquationNode.importJSON;

  exportDOM(): DOMExportOutput {
    const output = super.exportDOM();
    const element = output.element as HTMLElement;
    katex.render(this.__equation, element, {
      displayMode: !this.__inline, // true === block display //
      errorColor: "#cc0000",
      output: "html",
      strict: "warn",
      throwOnError: false,
      trust: false,
    });
    return output;
  }

  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={<BlockLoading />}>
        <EquationComponent
          equation={this.__equation}
          inline={this.__inline}
          nodeKey={this.__key}
        />
      </Suspense>
    );
  }
}
