import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  LexicalEditor,
} from "lexical";
import { DecoratorNode, $applyNodeReplacement } from "lexical";

import type { JSX } from "react";
import React, { Suspense } from "react";

const ChartComponent = React.lazy(() => import("./ChartComponent"));

export type ChartType = "bar" | "line" | "pie";

export type SerializedChartNode = Spread<
  {
    type: "chart";
    version: 1;
    chartType: ChartType;
    chartData: string;
    chartConfig: string;
    width?: number | "inherit";
    height?: number | "inherit";
  },
  SerializedLexicalNode
>;

export class ChartNode extends DecoratorNode<JSX.Element> {
  // ────────────────────────────────────────────────────────────
  // fields
  // ────────────────────────────────────────────────────────────
  __chartType: ChartType;
  __chartData: string;
  __chartConfig: string;
  __width: number | "inherit";
  __height: number | "inherit";

  // ────────────────────────────────────────────────────────────
  // boilerplate
  // ────────────────────────────────────────────────────────────
  static getType() {
    return "chart";
  }

  static clone(node: ChartNode) {
    return new ChartNode(
      node.__chartType,
      node.__chartData,
      node.__chartConfig,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  // ────────────────────────────────────────────────────────────
  // ctor
  // ────────────────────────────────────────────────────────────
  constructor(
    chartType: ChartType = "bar",
    chartData = "[]", // Default to empty array JSON
    chartConfig = "{}", // Default to empty object JSON
    width: number | "inherit" = "inherit",
    height: number | "inherit" = "inherit",
    key?: NodeKey,
  ) {
    super(key);
    this.__chartType = chartType;
    this.__chartData = chartData;
    this.__chartConfig = chartConfig;
    this.__width = width === 0 ? "inherit" : width;
    this.__height = height === 0 ? "inherit" : height;
  }

  // ────────────────────────────────────────────────────────────
  // getters / setters
  // ────────────────────────────────────────────────────────────
  getChartType() {
    return this.__chartType;
  }
  setChartType(type: ChartType) {
    this.getWritable().__chartType = type;
  }

  getChartData() {
    return this.__chartData;
  }
  setChartData(data: string) {
    this.getWritable().__chartData = data;
  }

  getChartConfig() {
    return this.__chartConfig;
  }
  setChartConfig(config: string) {
    this.getWritable().__chartConfig = config;
  }

  getWidth() {
    return this.__width;
  }
  getHeight() {
    return this.__height;
  }
  setWidthAndHeight({
    width,
    height,
  }: {
    width: number | "inherit";
    height: number | "inherit";
  }) {
    const w = width === 0 ? "inherit" : width;
    const h = height === 0 ? "inherit" : height;
    this.getWritable().__width = w;
    this.getWritable().__height = h;
  }

  // ────────────────────────────────────────────────────────────
  // serialisation
  // ────────────────────────────────────────────────────────────
  exportJSON(): SerializedChartNode {
    return {
      type: "chart",
      version: 1,
      chartType: this.__chartType,
      chartData: this.__chartData,
      chartConfig: this.__chartConfig,
      width: this.__width,
      height: this.__height,
    };
  }

  static importJSON(node: SerializedChartNode): ChartNode {
    return $applyNodeReplacement(
      new ChartNode(
        node.chartType,
        node.chartData,
        node.chartConfig,
        node.width,
        node.height,
      ),
    );
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    const cls = config.theme.image; // Re-use image class for selection outline

    span.style.display = "inline-block";
    // Prevent visual jump by setting initial size, will be overridden by ChartComponent
    span.style.width =
      typeof this.__width === "number" ? `${this.__width}px` : "300px";
    span.style.height =
      typeof this.__height === "number" ? `${this.__height}px` : "200px";
    if (cls) span.className = cls;
    return span;
  }

  updateDOM(prev: ChartNode, dom: HTMLElement): boolean {
    if (prev.__width !== this.__width) {
      dom.style.width =
        typeof this.__width === "number" ? `${this.__width}px` : "auto";
    }
    if (prev.__height !== this.__height) {
      dom.style.height =
        typeof this.__height === "number" ? `${this.__height}px` : "auto";
    }
    return false;
  }

  // ────────────────────────────────────────────────────────────
  // React render
  // ────────────────────────────────────────────────────────────
  decorate(editor: LexicalEditor, config: EditorConfig): JSX.Element {
    return (
      <Suspense fallback={null}>
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
    );
  }

  static $createChartNode(
    chartType?: ChartType,
    chartData?: string,
    chartConfig?: string,
    width?: number | "inherit",
    height?: number | "inherit",
  ): ChartNode {
    return new ChartNode(chartType, chartData, chartConfig, width, height);
  }

  static $isChartNode(node: LexicalNode | null): node is ChartNode {
    return node instanceof ChartNode;
  }
}
