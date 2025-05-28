"use client";

import React from "react";
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
  console.log("[DynamicChartRenderer] Data for chart:", data);

  // attempt to find a suitable key for XAxis
  const getXAxisDataKey = () => {
    if (data.length === 0) return "name"; // Default if no data
    const firstItem = data[0] as Record<string, unknown>;
    if (typeof firstItem.month === "string") return "month";
    if (typeof firstItem.name === "string") return "name";
    if (typeof firstItem.date === "string") return "date";
    if (typeof firstItem.category === "string") return "category";
    // fallback: find first key with string value
    for (const key in firstItem) {
      if (
        Object.prototype.hasOwnProperty.call(firstItem, key) &&
        typeof firstItem[key] === "string"
      ) {
        return key;
      }
    }
    return "name"; // ultimate fallback
  };

  const xAxisDataKey = getXAxisDataKey();

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
    console.log(
      "[DynamicChartRenderer] Auto-generated config:",
      generatedConfig,
    );
    return generatedConfig;
  };

  const chartConfig = getGeneratedChartConfig();
  const containerHeight = typeof height === "number" ? height : 200;

  if (!data || data.length === 0 || !Array.isArray(data)) {
    return (
      <Placeholder
        message="No data provided or data is not an array."
        height={containerHeight}
      />
    );
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
                fill={`var(--color-${key})`}
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
                stroke={`var(--color-${key})`}
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
              fill={`var(--color-${pieDataKey})`} // simplistic fill
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
      className="min-h-[150px] w-full" // min-h is important for responsiveness
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
