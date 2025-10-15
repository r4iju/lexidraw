"use client";

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip as ShadcnChartTooltip,
  ChartTooltipContent,
  ChartLegend as ShadcnChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "~/components/ui/chart"; // Assuming shadcn chart components are here

type ChartType = "bar" | "line" | "pie"; // Keep in sync with ChartNode

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
    color: "hsl(var(--chart-1))",
  },
};

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
  height,
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
    numericKeys.forEach((key, index) => {
      generatedConfig[key] = {
        label: key.charAt(0).toUpperCase() + key.slice(1), // capitalize key for label
        color: `hsl(var(--chart-${(index % 5) + 1}))`, // cycle through chart-1 to chart-5
      };
    });
    return generatedConfig;
  };

  const chartConfig = getGeneratedChartConfig();
  const containerHeight = typeof height === "number" ? height : 200;

  const message = useMemo(() => {
    switch (true) {
      case data === undefined || data === null:
        return "No data provided";
      case !Array.isArray(data):
        return "Data is not an array";
      case data.length === 0:
        return "Data is empty";
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
              dataKey={xAxisDataKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            <ShadcnChartLegend content={<ChartLegendContent />} />
            {Object.keys(chartConfig).map((key) => (
              <Bar
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
              dataKey={xAxisDataKey}
              tickLine={false}
              tickMargin={10}
              axisLine={false}
            />
            <YAxis />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            <ShadcnChartLegend content={<ChartLegendContent />} />
            {Object.keys(chartConfig).map((key) => (
              <Line
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
      case "pie": {
        // pie chart needs a 'value' key in data, and 'name' for labels
        // we'll assume the first key in config is the dataKey for the Pie
        const pieDataKey = Object.keys(chartConfig)[0] || "value";
        return (
          <PieChart>
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            <Pie
              data={data}
              dataKey={pieDataKey}
              nameKey={xAxisDataKey} // use detected xAxisDataKey for pie labels too
              cx="50%"
              cy="50%"
              outerRadius={"80%"}
              fill={`var(--color-${slugify(pieDataKey)})`}
            />
            <ShadcnChartLegend content={<ChartLegendContent />} />
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
      config={chartConfig}
      className="min-h-[50px] w-full" // min-h is important for responsiveness
      style={{
        // width: typeof _width === "number" ? `${_width}px` : "100%", // handled by parent or resizer
        height:
          typeof height === "number" ? `${height}px` : `${containerHeight}px`,
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        {renderChart()}
      </ResponsiveContainer>
    </ChartContainer>
  );
}
