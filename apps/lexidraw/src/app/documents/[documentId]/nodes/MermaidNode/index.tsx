import {
  $getFigure,
  $getNaturalSize,
  MermaidNode as HeadlessMermaidNode,
} from "@packages/lexical-nodes";
import type { JSX } from "react";
import React, { Suspense } from "react";
import {
  diagramStyle,
  FIGURE_FRAME,
  FigureLoading,
} from "../common/figure-box";
import { FigureFrame } from "../common/Figure";

export type { SerializedMermaidNode } from "@packages/lexical-nodes";

const MermaidComponent = React.lazy(() => import("./MermaidComponent"));

/** React half of the package's MermaidNode; see ImageNode. */
export class MermaidNode extends HeadlessMermaidNode {
  $config() {
    return this.config("mermaid", { extends: HeadlessMermaidNode });
  }

  decorate(): JSX.Element {
    const natural = $getNaturalSize(this);
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <Suspense
          fallback={
            <div className={FIGURE_FRAME}>
              <section className="document-mermaid">
                <FigureLoading
                  place={diagramStyle}
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
