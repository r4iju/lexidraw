import {
  $getFigure,
  $getNaturalSize,
  ExcalidrawNode as HeadlessExcalidrawNode,
} from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { cn } from "~/lib/utils";
import { FigureFrame } from "../common/Figure";
import {
  drawingStyle,
  FIGURE_FRAME,
  FigureLoading,
} from "../common/figure-box";

export type { SerializedExcalidrawNode } from "@packages/lexical-nodes";

const ExcalidrawComponent = React.lazy(() => import("./ExcalidrawComponent"));

/** React half of the package's ExcalidrawNode; see ImageNode. */
export class ExcalidrawNode extends HeadlessExcalidrawNode {
  $config() {
    return this.config("excalidraw", { extends: HeadlessExcalidrawNode });
  }

  decorate(): React.JSX.Element {
    const natural = $getNaturalSize(this);
    const figure = $getFigure(this);
    const fill = figure.width !== undefined;
    return (
      <FigureFrame nodeKey={this.getKey()} figure={figure}>
        <Suspense
          fallback={
            <div className={cn(FIGURE_FRAME, fill && "block w-full")}>
              <div
                className={cn(
                  "relative inline-block max-w-full",
                  fill && "block w-full",
                )}
              >
                <FigureLoading
                  place={drawingStyle}
                  width={this.__width}
                  height={this.__height}
                  natural={natural}
                  fill={fill}
                />
              </div>
            </div>
          }
        >
          <ExcalidrawComponent
            nodeKey={this.getKey()}
            data={this.__data}
            defaultOpen={this.__justInserted}
            width={this.__width}
            height={this.__height}
            natural={natural}
            fill={fill}
          />
        </Suspense>
      </FigureFrame>
    );
  }
}
