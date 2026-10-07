/** The document's colours a diagram is drawn with, each as `#rrggbb`. */
export type DiagramTokens = {
  page: string;
  surface: string;
  secondarySurface: string;
  foreground: string;
  border: string;
  muted: string;
  destructive: string;
  /** The app's chart palette, `--chart-1` onwards. */
  chart: string[];
};

/**
 * The lightness tiers (OKLCH) a coloured fill is drawn at: light enough for
 * dark ink to read on it, dark enough to stand out from a white page, and
 * far enough from a near-black page, so every theme shares the fills. A
 * chart colour lends its hue and chroma; each tier past the first shifts the
 * hue a little, so a tier's fills differ from the last tier's by more than
 * lightness.
 */
const TIERS = [
  { lightness: 0.78, hueShift: 0 },
  { lightness: 0.68, hueShift: 18 },
  { lightness: 0.84, hueShift: -24 },
];
const SLOTS = 12;

/**
 * Mermaid's `base` theme, coloured from the document's tokens: neutral
 * surfaces for flowcharts and their kin, and the chart palette for the
 * diagrams that tell their parts apart by colour (pie, gantt, mindmap,
 * timeline, git graph). Mermaid would otherwise rotate the hue of
 * `primaryColor`, which a grey surface does not have.
 */
export function mermaidThemeVariables(
  tokens: DiagramTokens,
  { dark }: { dark: boolean },
): Record<string, string | boolean> {
  const [page, foreground] = [tokens.page, tokens.foreground];
  // Labels on a coloured fill: the darkest of the theme's text and page.
  const ink = luminance(foreground) < luminance(page) ? foreground : page;
  const hues = tokens.chart.map(toOklch);
  const palette = Array.from({ length: SLOTS }, (_, slot) => {
    const tier = TIERS[Math.floor(slot / hues.length) % TIERS.length];
    const hue = hues[slot % hues.length];
    if (!tier || !hue) throw new Error("The chart palette is empty");
    return fill(hue, tier.lightness, tier.hueShift);
  });
  const crit = fill(toOklch(tokens.destructive), 0.78, 0);
  const done = fill({ ...toOklch(tokens.muted), c: 0 }, 0.8, 0);
  const outline = (colour: string) => fill(toOklch(colour), 0.55, 0);
  const slots = (
    name: string,
    value: (slot: number) => string,
    count = SLOTS,
  ) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, slot) => [
        `${name}${slot}`,
        value(slot),
      ]),
    );
  const at = (slot: number) => palette[slot % SLOTS] as string;
  const [blue, green] = [at(2), at(1)];

  return {
    darkMode: dark,
    primaryColor: tokens.surface,
    primaryTextColor: foreground,
    primaryBorderColor: tokens.border,
    lineColor: tokens.muted,
    secondaryColor: tokens.secondarySurface,
    tertiaryColor: page,

    // Pie: Mermaid numbers its slices from 1, and washes them out by default.
    ...Object.fromEntries(palette.map((colour, i) => [`pie${i + 1}`, colour])),
    pieOpacity: "1",
    pieStrokeColor: page,
    pieOuterStrokeColor: page,
    pieSectionTextColor: ink,
    pieTitleTextColor: foreground,
    pieLegendTextColor: foreground,

    // Gantt.
    titleColor: foreground,
    gridColor: tokens.border,
    sectionBkgColor: page,
    sectionBkgColor2: page,
    altSectionBkgColor: tokens.muted,
    taskBkgColor: blue,
    taskBorderColor: outline(blue),
    activeTaskBkgColor: green,
    activeTaskBorderColor: outline(green),
    doneTaskBkgColor: done,
    doneTaskBorderColor: outline(done),
    critBkgColor: crit,
    critBorderColor: outline(crit),
    todayLineColor: tokens.destructive,
    excludeBkgColor: tokens.secondarySurface,
    taskTextColor: ink,
    taskTextDarkColor: ink,
    taskTextLightColor: ink,
    taskTextOutsideColor: foreground,
    taskTextClickableColor: foreground,

    // Mindmap, timeline and kin: a branch per slot, its root on git0.
    ...slots("cScale", at),
    ...slots("cScaleLabel", () => ink),
    ...slots("git", at, 8),
    ...slots("gitBranchLabel", () => ink, 8),
  };
}

/**
 * Overrides for what the theme variables cannot reach: Mermaid draws an
 * active task's label in its in-bar colour even when the label sits beside
 * the bar, on the page.
 */
export function mermaidThemeCSS(tokens: DiagramTokens) {
  return [
    ".node rect, .node polygon, .node circle { filter: none !important; }",
    `text.taskTextOutsideLeft, text.taskTextOutsideRight { fill: ${tokens.foreground} !important; }`,
  ].join("\n");
}

type Oklch = { l: number; c: number; h: number };

/** A colour with the given hue at a fixed lightness, as vivid as sRGB holds. */
function fill({ c, h }: Oklch, lightness: number, hueShift: number) {
  const hue = h + hueShift;
  let [low, high] = [0, c];
  // The most chroma that stays inside sRGB, to a hundredth.
  while (high - low > 0.001) {
    const mid = (low + high) / 2;
    if (inGamut(oklchToLinear({ l: lightness, c: mid, h: hue }))) low = mid;
    else high = mid;
  }
  return toHex(oklchToLinear({ l: lightness, c: low, h: hue }));
}

function toLinear(hex: string) {
  return [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

function luminance(hex: string) {
  const [r, g, b] = toLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function toOklch(hex: string): Oklch {
  const [r, g, b] = toLinear(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    l: L,
    c: Math.hypot(A, B),
    h: (Math.atan2(B, A) * 180) / Math.PI,
  };
}

function oklchToLinear({ l: L, c, h }: Oklch) {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ] as const;
}

function inGamut(rgb: readonly number[]) {
  return rgb.every((channel) => channel >= -0.0001 && channel <= 1.0001);
}

function toHex(rgb: readonly number[]) {
  return `#${rgb
    .map((linear) => {
      const clamped = Math.min(1, Math.max(0, linear));
      const encoded =
        clamped <= 0.0031308
          ? clamped * 12.92
          : 1.055 * clamped ** (1 / 2.4) - 0.055;
      return Math.round(encoded * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}
