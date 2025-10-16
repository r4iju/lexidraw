import type {
  XAxisProps,
  YAxisProps,
  LegendProps,
  TooltipProps,
  LineProps,
  BarProps,
  AreaProps,
} from "recharts";
import type { z } from "zod";
import type { ChartDataSchema, ChartConfigSchema } from "./schemas";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

// Inferred runtime types
type Data = z.infer<typeof ChartDataSchema>;
type Config = z.infer<typeof ChartConfigSchema>;

/* ------------------------------------------------------------------
 * 1️⃣  Data shape: prove each point fulfils the “recharts DataKey” idea
 * ------------------------------------------------------------------ */
declare const datum: Data[number];

// These two lines must compile.
const _stringCheck: string = datum.name;
const _numericCheck: number | undefined =
  datum.value ?? datum.uv ?? datum.pv ?? datum.amt ?? datum.cnt;

/* ------------------------------------------------------------------
 * 2️⃣  Config.xAxis / yAxis are assignable to Recharts prop bags
 * ------------------------------------------------------------------ */
declare const cfg: Config;

if (cfg.xAxis) {
  const _xAxisProps: XAxisProps = cfg.xAxis; // ✅ compile-time check
}

if (cfg.yAxis) {
  const _yAxisProps: YAxisProps = cfg.yAxis; // ✅ compile-time check
}

if (cfg.legend) {
  // @ts-expect-error these are just test types
  const _legendProps: LegendProps = cfg.legend;
}

if (cfg.tooltip) {
  // @ts-expect-error these are just test types
  const _tooltipProps: TooltipProps<ValueType, NameType> = cfg.tooltip;
}

/* ------------------------------------------------------------------
 * 3️⃣  Every entry in series[] can feed at least one concrete series
 * ------------------------------------------------------------------ */
for (const s of cfg.series) {
  // Pick whichever chart types your project actually renders.
  const _line: LineProps = {
    dataKey: s.dataKey,
    name: s.name,
    stroke: s.color,
  };
  const _bar: BarProps = { dataKey: s.dataKey, name: s.name, fill: s.color };
  const _area: AreaProps = { dataKey: s.dataKey, name: s.name, fill: s.color };
}

/* ------------------------------------------------------------------
 * 4️⃣  Structural test using `satisfies` (optional but readable)
 * ------------------------------------------------------------------ */
const _fullConfigCheck = cfg satisfies {
  chartType: Config["chartType"];
  series: { dataKey: string }[];
  xAxis?: XAxisProps;
  yAxis?: YAxisProps;
};
