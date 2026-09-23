import { ExcalidrawNode as HeadlessExcalidrawNode } from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";

export type { SerializedExcalidrawNode } from "@packages/lexical-nodes";

const ExcalidrawComponent = React.lazy(() => import("./ExcalidrawComponent"));

/** React half of the package's ExcalidrawNode; see ImageNode. */
export class ExcalidrawNode extends HeadlessExcalidrawNode {
  static getType = HeadlessExcalidrawNode.getType;
  static clone = HeadlessExcalidrawNode.clone;
  static importJSON = HeadlessExcalidrawNode.importJSON;

  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <ExcalidrawComponent
          nodeKey={this.getKey()}
          data={this.__data}
          defaultOpen={this.__justInserted}
          width={this.__width}
          height={this.__height}
        />
      </Suspense>
    );
  }
}
