"use client";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import {
  ResponsiveContainer,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
} from "recharts";

export function RequestsChart(props: {
  data: { day: string; requests: number }[];
}) {
  return (
    <ChartContainer
      className="mt-3"
      config={{ Requests: { label: "Requests", color: "hsl(var(--chart-1))" } }}
    >
      <ResponsiveContainer>
        <LineChart data={props.data} margin={{ left: 12, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" tickMargin={8} />
          <YAxis allowDecimals={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            type="monotone"
            dataKey="requests"
            stroke="var(--color-requests)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
