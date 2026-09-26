import {
  $create,
  DecoratorNode,
  type EditorConfig,
  enumValue,
  type Klass,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type SerializedLexicalNode,
  type Spread,
  stringValue,
  withField,
} from "lexical";
import { figureDOM, figureState } from "../figure.js";
import { zeroAsInheritValue } from "../schema-values.js";

export const CHART_TYPES = ["bar", "line", "pie"] as const;

export type ChartType = (typeof CHART_TYPES)[number];

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

const chartSchema = nodeSchema<ChartNode>()({
  chartType: withField(enumValue(CHART_TYPES), { field: "__chartType" }),
  chartData: withField(stringValue("[]"), { field: "__chartData" }),
  chartConfig: withField(stringValue("{}"), { field: "__chartConfig" }),
  width: withField(zeroAsInheritValue, { field: "__width" }),
  height: withField(zeroAsInheritValue, { field: "__height" }),
});

export class ChartNode extends DecoratorNode<unknown> {
  __chartType: ChartType;
  __chartData: string;
  __chartConfig: string;
  __width: number | "inherit";
  __height: number | "inherit";

  $config() {
    return this.config("chart", {
      extends: DecoratorNode,
      json: chartSchema,
      stateConfigs: [figureState],
    });
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

  isInline(): false {
    return false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.dataset.mediaType = "chart";
    figureDOM(this, element);
    return element;
  }

  updateDOM(_prevNode: ChartNode, dom: HTMLElement): false {
    figureDOM(this, dom);
    return false;
  }
}
