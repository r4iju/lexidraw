import {
  $getFigure,
  $getNaturalSize,
  ExcalidrawNode as HeadlessExcalidrawNode,
} from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { FigureFrame } from "../common/Figure";
import { DRAWING_FRAME, DrawingLoading } from "./excalidraw-box";

export type { SerializedExcalidrawNode } from "@packages/lexical-nodes";

const ExcalidrawComponent = React.lazy(() => import("./ExcalidrawComponent"));

/** React half of the package's ExcalidrawNode; see ImageNode. */
export class ExcalidrawNode extends HeadlessExcalidrawNode {
  static getType = HeadlessExcalidrawNode.getType;
  static clone = HeadlessExcalidrawNode.clone;
  static importJSON = HeadlessExcalidrawNode.importJSON;

  decorate(): React.JSX.Element {
    const natural = $getNaturalSize(this);
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <Suspense
          fallback={
            <div className={DRAWING_FRAME}>
              <div className="relative inline-block max-w-full">
                <DrawingLoading
                  width={this.__width}
                  height={this.__height}
                  natural={natural}
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
          />
        </Suspense>
      </FigureFrame>
    );
  }
}
