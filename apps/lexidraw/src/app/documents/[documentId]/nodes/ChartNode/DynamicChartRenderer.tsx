"use client";

import { CHART_TYPES, type ChartType } from "@packages/lexical-nodes";
import { ChartColumn } from "lucide-react";
import { type ReactNode, useId } from "react";
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
  Text,
  type XAxisProps,
  type XAxisTickContentProps,
  type YAxisProps,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip as ShadcnChartTooltip,
  ChartTooltipContent,
  ChartLegend as ShadcnChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "~/components/ui/chart";
import { cn } from "~/lib/utils";

interface DynamicChartRendererProps {
  chartType: ChartType;
  data: unknown[];
  config: ChartConfig;
  width: number | "inherit";
  height: number | "inherit";
  /** Whether the reader can open the chart's editor, for the empty state. */
  editable?: boolean;
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

/**
 * Room for the widest category label on one line, at most a slot past which
 * long labels wrap and truncate instead of thinning the axis further. Widths
 * are estimated at the 12px axis font: wide (CJK) characters about 12px,
 * others about 7px.
 */
function labelSlot(labels: string[]) {
  const width = (label: string) =>
    [...label].reduce(
      (sum, character) => sum + (/[\u2E80-\uFFEF]/.test(character) ? 12 : 7),
      0,
    );
  return Math.min(80, Math.max(32, ...labels.map(width)) + 8);
}

/**
 * A category label that wraps to two lines within its slot and ends in an
 * ellipsis past that, given the slot it needs from `labelSlot`. Recharts would instead drop labels it measures as
 * overlapping at full length, so the axis shows every tick and this tick
 * thins itself: on a crowded axis every n-th label gets n slots, and a label
 * whose slot would reach past the plot's end is left out.
 */
function CategoryTick({
  x,
  y,
  payload,
  index,
  visibleTicksCount,
  width,
  fill,
  minSlot,
}: XAxisTickContentProps & { minSlot: number }) {
  const band = Number(width) / visibleTicksCount;
  const stride = Math.ceil(minSlot / band);
  if (index % stride !== 0 || index + stride / 2 > visibleTicksCount - 0.5)
    return null;
  const label = String(payload.value);
  return (
    <Text
      x={x}
      y={y}
      width={band * stride - 4}
      maxLines={2}
      // Text without spaces (Japanese, Chinese) can only wrap between characters.
      breakAll={!/\s/.test(label)}
      textAnchor="middle"
      verticalAnchor="start"
      fill={fill}
      fontSize={12}
      className="recharts-cartesian-axis-tick-value"
    >
      {label}
    </Text>
  );
}

// Legends wrap on narrow charts and read as quietly as the axes.
const LEGEND_CLASS = "flex-wrap gap-x-4 gap-y-1 text-muted-foreground";

const isChartType = (type: string): type is ChartType =>
  (CHART_TYPES as readonly string[]).includes(type);

/** A quiet stand-in, with a chart icon, for a chart with nothing to draw. */
function ChartNotice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-full min-h-24 flex-col items-center justify-center gap-1.5 rounded-md border border-border border-dashed p-4 text-center text-muted-foreground text-sm",
        className,
      )}
    >
      <ChartColumn aria-hidden className="size-5 shrink-0" />
      <p className="m-0">{children}</p>
    </div>
  );
}

export default function DynamicChartRenderer({
  chartType,
  data,
  config: rawConfig,
  width: _width, // unused
  height: _height,
  editable = false,
}: DynamicChartRendererProps) {
  const gradientId = `area-${useId().replace(/:/g, "")}`;
  if (!isChartType(chartType))
    return (
      <ChartNotice className="absolute inset-0">
        This chart type ({chartType}) can't be shown.
      </ChartNotice>
    );
  if (!Array.isArray(data) || data.length === 0)
    return (
      <ChartNotice>
        {editable
          ? "Edit the chart to add data."
          : "This chart has no data yet."}
      </ChartNotice>
    );

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
  const axisStyle = { fontSize: 12, fill: "var(--muted-foreground)" };
  const minSlot = labelSlot(
    data.map((row) => String((row as Record<string, unknown>)[xAxisDataKey])),
  );
  // Bands put half a category of room before the first point and after the
  // last, so line and area ends and their labels stay inside the frame.
  const categoryAxis: XAxisProps = {
    dataKey: xAxisDataKey,
    scale: "band",
    tick: (props: XAxisTickContentProps) => (
      <CategoryTick {...props} minSlot={minSlot} />
    ),
    interval: 0,
    height: 40,
    tickLine: false,
    tickMargin: 8,
    axisLine: false,
  };
  const firstLabel = chartConfig[series[0] ?? ""]?.label;
  // One series gets no legend, so the value axis names it.
  const valueAxis: YAxisProps = {
    tick: axisStyle,
    // The default 5px gap makes Recharts drop a tick on a phone-height
    // chart, leaving uneven steps; ticks 12px tall still clear each other.
    minTickGap: 0,
    tickLine: false,
    axisLine: false,
    label:
      series.length === 1
        ? {
            value:
              typeof firstLabel === "string" || typeof firstLabel === "number"
                ? firstLabel
                : series[0],
            angle: -90,
            position: "insideLeft",
            ...axisStyle,
          }
        : undefined,
  };
  // Past a dozen points, markers on a phone-width line touch; the line and
  // the hover dot carry the values instead.
  const pointMarkers = data.length <= 12 && { r: 4, strokeWidth: 2 };
  // A pie's first series holds each slice's value; its legend names slices.
  const pieDataKey = series[0] ?? "value";

  const renderChart = () => {
    switch (chartType) {
      case "bar":
        return (
          <BarChart data={data} layout="horizontal">
            <CartesianGrid vertical={false} />
            <XAxis {...categoryAxis} />
            <YAxis {...valueAxis} />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend
                content={<ChartLegendContent className={LEGEND_CLASS} />}
              />
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
            <CartesianGrid vertical={false} />
            <XAxis {...categoryAxis} />
            <YAxis {...valueAxis} />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend
                content={<ChartLegendContent className={LEGEND_CLASS} />}
              />
            )}
            {Object.keys(chartConfig).map((key) => (
              <Line
                isAnimationActive={false}
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`var(--color-${slugify(key)})`}
                strokeWidth={2}
                dot={pointMarkers}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis {...categoryAxis} />
            <YAxis {...valueAxis} />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend
                content={<ChartLegendContent className={LEGEND_CLASS} />}
              />
            )}
            <defs>
              {series.map((key) => (
                // Fading to nothing keeps overlapping areas from muddying.
                <linearGradient
                  key={key}
                  id={`${gradientId}-${slugify(key)}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={`var(--color-${slugify(key)})`}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor={`var(--color-${slugify(key)})`}
                    stopOpacity={0.02}
                  />
                </linearGradient>
              ))}
            </defs>
            {series.map((key) => (
              <Area
                isAnimationActive={false}
                key={key}
                type="monotone"
                dataKey={key}
                stroke={`var(--color-${slugify(key)})`}
                fill={`url(#${gradientId}-${slugify(key)})`}
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
              <ShadcnChartLegend
                content={<ChartLegendContent className={LEGEND_CLASS} />}
              />
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
            {numericX ? (
              <XAxis
                tick={axisStyle}
                dataKey={xAxisDataKey}
                type="number"
                // Recharts starts number axes at zero; points start anywhere,
                // and need room for their markers at either end.
                domain={["auto", "auto"]}
                padding={{ left: 12, right: 12 }}
                tickLine={false}
                tickMargin={8}
                axisLine={false}
              />
            ) : (
              <XAxis {...categoryAxis} allowDuplicatedCategory={false} />
            )}
            <YAxis {...valueAxis} type="number" />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend
                content={<ChartLegendContent className={LEGEND_CLASS} />}
              />
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
            <XAxis {...categoryAxis} />
            <YAxis {...valueAxis} />
            <ShadcnChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 && (
              <ShadcnChartLegend
                content={<ChartLegendContent className={LEGEND_CLASS} />}
              />
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
                  dot={pointMarkers}
                  activeDot={{ r: 5, strokeWidth: 2 }}
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
                  className={LEGEND_CLASS}
                />
              }
            />
          </PieChart>
        );
      }
      default:
        return chartType satisfies never;
    }
  };

  return (
    <ChartContainer
      config={
        chartType === "pie"
          ? { ...chartConfig, ...sliceLabels(data, xAxisDataKey, pieDataKey) }
          : chartConfig
      }
      // Recharts makes the plot focusable for arrow-key tooltips; a click
      // should select the block without drawing a focus ring inside it.
      className="min-h-[50px] w-full [&_g:focus:not(:focus-visible)]:outline-none"
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
