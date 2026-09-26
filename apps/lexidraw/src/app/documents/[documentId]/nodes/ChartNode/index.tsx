import {
  $getFigure,
  ChartNode as HeadlessChartNode,
  parseNaturalSize,
} from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import type { JSX } from "react";
import React, { Suspense } from "react";
import { BlockLoading } from "../common/BlockLoading";
import { FigureFrame } from "../common/Figure";

export type { ChartType, SerializedChartNode } from "@packages/lexical-nodes";

const ChartComponent = React.lazy(() => import("./ChartComponent"));

/** React half of the package's ChartNode; see ImageNode. */
export class ChartNode extends HeadlessChartNode {
  $config() {
    return this.config("chart", { extends: HeadlessChartNode });
  }

  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element {
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <Suspense
          fallback={
            <BlockLoading
              size={parseNaturalSize({
                width: this.__width,
                height: this.__height,
              })}
            />
          }
        >
          <ChartComponent
            nodeKey={this.getKey()}
            chartType={this.__chartType}
            chartData={this.__chartData}
            chartConfig={this.__chartConfig}
            width={this.__width}
            height={this.__height}
            editor={editor}
            config={config}
          />
        </Suspense>
      </FigureFrame>
    );
  }
}
