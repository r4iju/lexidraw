import {
  $getFigure,
  $getNaturalSize,
  MermaidNode as HeadlessMermaidNode,
} from "@packages/lexical-nodes";
import type { JSX } from "react";
import React, { Suspense } from "react";
import { DIAGRAM_FRAME, DiagramLoading } from "./mermaid-box";
import { FigureFrame } from "../common/Figure";

export type { SerializedMermaidNode } from "@packages/lexical-nodes";

const MermaidComponent = React.lazy(() => import("./MermaidComponent"));

/** React half of the package's MermaidNode; see ImageNode. */
export class MermaidNode extends HeadlessMermaidNode {
  static getType = HeadlessMermaidNode.getType;
  static clone = HeadlessMermaidNode.clone;
  static importJSON = HeadlessMermaidNode.importJSON;

  decorate(): JSX.Element {
    const natural = $getNaturalSize(this);
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <Suspense
          fallback={
            <div className={DIAGRAM_FRAME}>
              <section className="document-mermaid">
                <DiagramLoading
                  width={this.__width}
                  height={this.__height}
                  natural={natural}
                />
              </section>
            </div>
          }
        >
          <MermaidComponent
            nodeKey={this.getKey()}
            schema={this.__schema}
            width={this.__width}
            height={this.__height}
            natural={natural}
          />
        </Suspense>
      </FigureFrame>
    );
  }
}
