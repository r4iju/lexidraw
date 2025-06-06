import { z } from "zod";

/* ------------------------------------------------------------------ *
 * 1.  Chart Data – array of points                                    *
 * ------------------------------------------------------------------ *
 * Recharts examples consistently use an object with a `name` string  *
 * plus one or more numeric series keys such as `uv`, `pv`, `amt`,     *
 * or a single `value` for pies. We make those keys explicit instead   *
 * of allowing “anything”. At least one numeric key is required.       *
 * ------------------------------------------------------------------ */

const ChartDataPointSchema = z
  .object({
    name: z.string(),
    /* Generic single-series (“value”) — e.g. PieChart */
    value: z.number().optional(),

    /* Conventional multi-series keys from the docs */
    uv: z.number().optional(),
    pv: z.number().optional(),
    amt: z.number().optional(),
    cnt: z.number().optional(),
  })
  .strict()
  .refine(
    (d) =>
      ["value", "uv", "pv", "amt", "cnt"].some(
        (k) => (d as Record<string, unknown>)[k] !== undefined,
      ),
    { message: "Each data point must include at least one numeric series" },
  );

export const ChartDataSchema = z
  .array(ChartDataPointSchema)
  .min(1, "Chart needs at least one data point");

/* ------------------------------------------------------------------ *
 * 2.  Chart Config – declarative options you would otherwise pass as  *
 *     props to Recharts building blocks.                              *
 * ------------------------------------------------------------------ */

const MarginSchema = z
  .object({
    top: z.number().optional(),
    right: z.number().optional(),
    bottom: z.number().optional(),
    left: z.number().optional(),
  })
  .strict();

const AxisSchema = z
  .object({
    /** Required in virtually every example: which key from data drives the axis */
    dataKey: z.string(),
    /** “number” | “category” in the official API */
    type: z.enum(["number", "category"]).optional(),
    /** Nice‐to-have extras frequently used */
    unit: z.string().optional(),
    allowDecimals: z.boolean().optional(),
  })
  .strict();

const SeriesSchema = z
  .object({
    /** The field in ChartDataSchema that this series reads from */
    dataKey: z.string(),

    /** Friendly name shown in tooltips/legend */
    name: z.string().optional(),

    /** Stroke/fill colour in hex (validated) */
    color: z
      .string()
      .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, {
        message: "Color must be a valid hex code",
      })
      .optional(),

    /** Optional stacking key for Bar/Area charts */
    stackId: z.string().optional(),
  })
  .strict()
  .describe(
    "Plausible data objects, e.g. [{name:'A',value:10}, …]. The data must be in the same format as the data in the chartConfig.",
  );

export const ChartConfigSchema = z
  .object({
    /** Core chart to render */
    chartType: z.enum([
      "bar",
      "line",
      "area",
      "pie",
      "radar",
      "scatter",
      "composed",
    ]),

    /** Layout direction for Bar/Area/Line charts */
    layout: z.enum(["horizontal", "vertical"]).optional(),

    /** Dimensions or let <ResponsiveContainer> handle it */
    width: z.number().optional(),
    height: z.number().optional(),
    margin: MarginSchema.optional(),

    /** Axes */
    xAxis: AxisSchema.optional(),
    yAxis: AxisSchema.optional(),

    /** Each visual series that should be drawn */
    series: z.array(SeriesSchema).min(1),

    /** Common auxiliary blocks */
    legend: z
      .object({
        position: z
          .enum(["top", "bottom", "left", "right", "inside", "none"])
          .optional(),
      })
      .strict()
      .optional(),

    tooltip: z
      .object({
        /** Name of a formatter function accessible at runtime */
        formatter: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .describe(
    'Chart configuration options as a JSON object (e.g., for Recharts, defining colors or labels: {value: {label: "Sales", color: "#8884d8"}}). Empty object {} is fine.',
  );
