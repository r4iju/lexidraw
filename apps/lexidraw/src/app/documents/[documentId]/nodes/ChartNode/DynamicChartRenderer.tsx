"use client";

import type { ChartType } from "@packages/lexical-nodes";
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ScatterChart,
  Scatter,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip as ShadcnChartTooltip,
  ChartTooltipContent,
  ChartLegend as ShadcnChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "~/components/ui/chart"; // Assuming shadcn chart components are here

interface DynamicChartRendererProps {
  chartType: ChartType;
  data: unknown[];
  config: ChartConfig;
  width: number | "inherit";
  height: number | "inherit";
}

const DEFAULT_CHART_CONFIG: ChartConfig = {
  value: {
    label: "Value",
    color: "chart-1",
  },
};

const PALETTE_SIZE = 5;

/**
 * The n-th category's colour: the chart palette, then lighter tints of it
 * once the palette repeats, so slices stay distinguishable in both themes.
 */
function categoryColor(index: number) {
  const base = `var(--chart-${(index % PALETTE_SIZE) + 1})`;
  const round = Math.floor(index / PALETTE_SIZE);
  if (round === 0) return base;
  return `color-mix(in oklab, ${base} ${Math.max(30, 100 - round * 35)}%, var(--background))`;
}

/** Legend entries naming each pie slice with its rounded share. */
function sliceLabels(
  data: unknown[],
  nameKey: string,
  valueKey: string,
): ChartConfig {
  const rows = data as Record<string, unknown>[];
  const value = (row: Record<string, unknown>) => Number(row[valueKey]) || 0;
  const total = rows.reduce((sum, row) => sum + value(row), 0);
  return Object.fromEntries(
    rows.map((row) => {
      const name = String(row[nameKey]);
      const share = total ? Math.round((value(row) / total) * 100) : 0;
      return [
        name,
        {
          label: (
            <>
              {name}
              <span className="ml-1 text-muted-foreground tabular-nums">
                {share}%
              </span>
            </>
          ),
        },
      ];
    }),
  );
}

const Placeholder = ({
  message,
  height,
}: {
  message: string;
  height: number | string;
}) => (
  <div
    className="flex items-center justify-center bg-muted/20 text-muted-foreground text-xs p-2 rounded"
    style={{ height, width: "100%" }}
  >
    {message}
  </div>
);

export default function DynamicChartRenderer({
  chartType,
  data,
  config: rawConfig,
  width: _width, // unused
  height: _height,
}: DynamicChartRendererProps) {
  // attempt to find a suitable key for XAxis
  const getXAxisDataKey = () => {
    if (data.length === 0) return "name"; // Default if no data
    const firstItem = data[0] as Record<string, unknown>;

    const commonKeys = ["year", "month", "name", "date", "category"];
    for (const commonKey of commonKeys) {
      if (Object.hasOwn(firstItem, commonKey)) {
        // Check if it's string or number, as Recharts can handle both for dataKey
        if (
          typeof firstItem[commonKey] === "string" ||
          typeof firstItem[commonKey] === "number"
        ) {
          return commonKey;
        }
      }
    }

    for (const key in firstItem) {
      if (Object.hasOwn(firstItem, key)) {
        if (
          typeof firstItem[key] === "string" ||
          typeof firstItem[key] === "number"
        ) {
          return key;
        }
      }
    }
    return "name"; // Ultimate fallback
  };

  const xAxisDataKey = getXAxisDataKey();

  const slugify = (str: string) =>
    str
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w-]+/g, "");

  // determine the chart configuration
  const getGeneratedChartConfig = (): ChartConfig => {
    if (Object.keys(rawConfig).length > 0) {
      return rawConfig; // Use provided config if available
    }
    // auto-generate config from data
    if (
      !data ||
      data.length === 0 ||
      !Array.isArray(data) ||
      typeof data[0] !== "object" ||
      data[0] === null
    ) {
      return DEFAULT_CHART_CONFIG; // Fallback if data is not suitable for generation
    }

    const firstItem = data[0] as Record<string, unknown>;
    const numericKeys = Object.keys(firstItem).filter(
      (key) => typeof firstItem[key] === "number" && key !== xAxisDataKey,
    );

    if (numericKeys.length === 0) {
      return DEFAULT_CHART_CONFIG; // Fallback if no numeric keys found
    }

    const generatedConfig: ChartConfig = {};
    for (const key of numericKeys) {
      const index = numericKeys.indexOf(key);
      generatedConfig[key] = {
        label: key.charAt(0).toUpperCase() + key.slice(1), // capitalize key for label
        color: `chart-${(index % 5) + 1}`, // cycle through chart-1 to chart-5
      };
    }
    return generatedConfig;
  };

  const chartConfig = getGeneratedChartConfig();
  const series = Object.keys(chartConfig);
  const singleSeries =
    series.length === 1 ? chartConfig[series[0] ?? ""]?.label : undefined;
  const axisStyle = { fontSize: 12, fill: "var(--muted-foreground)" };
  const containerHeight = "100%";
  // A pie's first series holds each slice's value; its legend names slices.
  const pieDataKey = series[0] ?? "value";

  const message = useMemo(() => {
    switch (true) {
      case data === undefined || data === null:
        return "No data provided";
      case !Array.isArray(data):
        return "Data is not an array";
      case data.length === 0:
        return "Edit chart to add data.";
      default:
        return "Unsupported chart data";
    }
  }, [data]);

  if (!data || data.length === 0 || !Array.isArray(data)) {
    return <Placeholder message={message} height={containerHeight} />;
  }

  const renderChart = () => {
    switch (chartType) {
      case "bar":
        return (
          <BarChart data={data} layout="horizontal">
            <CartesianGrid vertical={false} />
            <XAxis
              tick={axisStyle}
              dataKey={xAxisDataKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis
              tick={axisStyle}
              tickLine={false}
              axisLine={false}
              label={
                singleSeries
                  ? {
                      value:
                        typeof singleSeries === "string" ||
                        typeof singleSeries === "number"
                          ? singleSeries
                          : series[0],
                      angle: -90,
                      position: "insideLeft",
                      ...axisStyle,
                    }
                  : undefined
              }
            />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend content={<ChartLegendContent />} />
            )}
            {Object.keys(chartConfig).map((key) => (
              <Bar
                isAnimationActive={false}
                key={key}
                dataKey={key}
                fill={`var(--color-${slugify(key)})`}
                radius={4}
              />
            ))}
          </BarChart>
        );
      case "line":
        return (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              tick={axisStyle}
              scale="band"
              dataKey={xAxisDataKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis
              tick={axisStyle}
              tickLine={false}
              axisLine={false}
              label={
                singleSeries
                  ? {
                      value:
                        typeof singleSeries === "string" ||
                        typeof singleSeries === "number"
                          ? singleSeries
                          : series[0],
                      angle: -90,
                      position: "insideLeft",
                      ...axisStyle,
                    }
                  : undefined
              }
            />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend content={<ChartLegendContent />} />
            )}
            {Object.keys(chartConfig).map((key) => (
              <Line
                isAnimationActive={false}
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`var(--color-${slugify(key)})`}
                strokeWidth={4}
                dot={{
                  // Style for the dots on the line
                  r: 5, // Radius of the dot
                  strokeWidth: 2,
                  // fill: `var(--color-${slugify(key)})` // Dot will inherit line color by default
                }}
                activeDot={{
                  // Style for the dot when hovered/active
                  r: 5, // Larger radius for active dot
                  strokeWidth: 2,
                  // fill: `var(--color-${slugify(key)})`, // Can also be a different color e.g. white with line color stroke
                  // stroke: `var(--color-${slugify(key)})`
                }}
              />
            ))}
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              tick={axisStyle}
              dataKey={xAxisDataKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend content={<ChartLegendContent />} />
            )}
            {series.map((key) => (
              <Area
                isAnimationActive={false}
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`var(--color-${slugify(key)})`}
                fill={`var(--color-${slugify(key)})`}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        );
      case "radar":
        return (
          <RadarChart data={data} outerRadius="70%">
            <PolarGrid />
            <PolarAngleAxis dataKey={xAxisDataKey} tick={axisStyle} />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend content={<ChartLegendContent />} />
            )}
            {series.map((key) => (
              <Radar
                isAnimationActive={false}
                key={key}
                dataKey={key}
                stroke={`var(--color-${slugify(key)})`}
                fill={`var(--color-${slugify(key)})`}
                fillOpacity={0.2}
                strokeWidth={2}
              />
            ))}
          </RadarChart>
        );
      case "scatter": {
        const numericX = data.every(
          (row) =>
            typeof (row as Record<string, unknown>)[xAxisDataKey] === "number",
        );
        return (
          <ScatterChart>
            <CartesianGrid />
            <XAxis
              tick={axisStyle}
              dataKey={xAxisDataKey}
              type={numericX ? "number" : "category"}
              allowDuplicatedCategory={false}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis
              tick={axisStyle}
              type="number"
              tickLine={false}
              axisLine={false}
            />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend content={<ChartLegendContent />} />
            )}
            {series.map((key) => (
              <Scatter
                isAnimationActive={false}
                key={key}
                data={data}
                dataKey={key}
                fill={`var(--color-${slugify(key)})`}
              />
            ))}
          </ScatterChart>
        );
      }
      case "composed":
        return (
          <ComposedChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              tick={axisStyle}
              dataKey={xAxisDataKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend content={<ChartLegendContent />} />
            )}
            {series.map((key, index) =>
              index === 0 ? (
                <Bar
                  isAnimationActive={false}
                  key={key}
                  dataKey={key}
                  fill={`var(--color-${slugify(key)})`}
                  radius={4}
                />
              ) : (
                <Line
                  isAnimationActive={false}
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={`var(--color-${slugify(key)})`}
                  strokeWidth={2}
                />
              ),
            )}
          </ComposedChart>
        );
      case "pie": {
        const rows = data as Record<string, unknown>[];
        return (
          <PieChart>
            <ShadcnChartTooltip
              content={<ChartTooltipContent nameKey={xAxisDataKey} />}
            />
            <Pie
              isAnimationActive={false}
              data={data}
              dataKey={pieDataKey}
              nameKey={xAxisDataKey}
              cx="50%"
              cy="50%"
              outerRadius={"80%"}
              stroke="var(--background)"
              strokeWidth={2}
            >
              {rows.map((row, index) => (
                <Cell
                  key={String(row[xAxisDataKey])}
                  fill={categoryColor(index)}
                />
              ))}
            </Pie>
            <ShadcnChartLegend
              itemSorter={null}
              content={
                <ChartLegendContent
                  nameKey={xAxisDataKey}
                  className="flex-wrap gap-x-4 gap-y-1"
                />
              }
            />
          </PieChart>
        );
      }
      default:
        return (
          <Placeholder
            message={`Unsupported chart type: ${chartType}`}
            height={containerHeight}
          />
        );
    }
  };

  return (
    <ChartContainer
      config={
        chartType === "pie"
          ? { ...chartConfig, ...sliceLabels(data, xAxisDataKey, pieDataKey) }
          : chartConfig
      }
      className="min-h-[50px] w-full" // min-h is important for responsiveness
      style={{
        position: "absolute",
        inset: 0,
        height: "100%",
        aspectRatio: "auto",
      }}
    >
      {renderChart()}
    </ChartContainer>
  );
}
