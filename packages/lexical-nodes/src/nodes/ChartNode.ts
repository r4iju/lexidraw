import type {
  Klass,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { $create, DecoratorNode } from "lexical";

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

export class ChartNode extends DecoratorNode<unknown> {
  __chartType: ChartType;
  __chartData: string;
  __chartConfig: string;
  __width: number | "inherit";
  __height: number | "inherit";

  static getType() {
    return "chart";
  }

  static clone(node: ChartNode) {
    return new this(
      node.__chartType,
      node.__chartData,
      node.__chartConfig,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  constructor(
    chartType: ChartType = "bar",
    chartData = "[]",
    chartConfig = "{}",
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
    return ChartNode.$createChartNode({
      chartType: node.chartType,
      chartData: node.chartData,
      chartConfig: node.chartConfig,
      width: node.width,
      height: node.height,
    });
  }

  static $createChartNode<T extends ChartNode>(
    this: Klass<T>,
    {
      chartType = "bar",
      chartData = "[]",
      chartConfig = "{}",
      width = "inherit",
      height = "inherit",
    }: {
      chartType?: ChartType;
      chartData?: string;
      chartConfig?: string;
      width?: number | "inherit";
      height?: number | "inherit";
    } = {},
  ): T {
    const node = $create(this);
    node.__chartType = chartType;
    node.__chartData = chartData;
    node.__chartConfig = chartConfig;
    node.__width = width === 0 ? "inherit" : width;
    node.__height = height === 0 ? "inherit" : height;
    return node;
  }

  static $isChartNode<T extends ChartNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof ChartNode;
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
}
