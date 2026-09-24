import { MermaidNode as HeadlessMermaidNode } from "@packages/lexical-nodes";
import type { JSX } from "react";
import React, { Suspense } from "react";
import { BlockLoading } from "../common/BlockLoading";

export type { SerializedMermaidNode } from "@packages/lexical-nodes";

const MermaidComponent = React.lazy(() => import("./MermaidComponent"));

/** React half of the package's MermaidNode; see ImageNode. */
export class MermaidNode extends HeadlessMermaidNode {
  static getType = HeadlessMermaidNode.getType;
  static clone = HeadlessMermaidNode.clone;
  static importJSON = HeadlessMermaidNode.importJSON;

  decorate(): JSX.Element {
    return (
      <Suspense fallback={<BlockLoading />}>
        <MermaidComponent
          nodeKey={this.getKey()}
          schema={this.__schema}
          width={this.__width}
          height={this.__height}
        />
      </Suspense>
    );
  }
}
