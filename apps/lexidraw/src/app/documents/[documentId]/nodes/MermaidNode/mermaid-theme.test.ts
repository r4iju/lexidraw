import { describe, expect, test } from "bun:test";
import { type DiagramTokens, mermaidThemeVariables } from "./mermaid-theme";

// The tokens as the browser resolves them in each theme, and on paper.
const LIGHT: DiagramTokens = {
  page: "#fafafb",
  surface: "#ffffff",
  secondarySurface: "#ffffff",
  foreground: "#1c1c22",
  border: "#e1e1e4",
  muted: "#5f6067",
  destructive: "#c51d28",
  chart: ["#c65d26", "#008757", "#1f74bf", "#9d7c00", "#a04c9a"],
};
const DARK: DiagramTokens = {
  page: "#0f0f12",
  surface: "#17171b",
  secondarySurface: "#202025",
  foreground: "#e4e4e8",
  border: "#303034",
  muted: "#a4a4ab",
  destructive: "#f75d59",
  chart: ["#f0834e", "#44b782", "#53a3f2", "#cba63a", "#cb73c4"],
};
const PAPER: DiagramTokens = {
  ...DARK,
  page: "#ffffff",
  surface: "#f5f5f8",
  secondarySurface: "#f5f5f8",
  foreground: "#1c1c22",
  border: "#d0d0d5",
  muted: "#5f6067",
};
const THEMES = [
  ["light", LIGHT, false],
  ["dark", DARK, true],
  ["paper", PAPER, false],
] as const;

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
      const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light = 0, dark = 0] = [luminance(a), luminance(b)].sort(
    (x, y) => y - x,
  );
  return (light + 0.05) / (dark + 0.05);
}

const colour = (value: unknown) => {
  expect(value).toMatch(/^#[0-9a-f]{6}$/);
  return value as string;
};

describe.each(THEMES)("on the %s theme", (_, tokens, dark) => {
  const theme = mermaidThemeVariables(tokens, { dark });

  test("pie slices have twelve distinct, opaque colours that stand out from the page, with legible labels", () => {
    const slices = Array.from({ length: 12 }, (_, i) =>
      colour(theme[`pie${i + 1}`]),
    );
    expect(new Set(slices).size).toBe(12);
    expect(theme.pieOpacity).toBe("1");
    const label = colour(theme.pieSectionTextColor);
    for (const slice of slices) {
      expect(contrast(slice, tokens.page)).toBeGreaterThanOrEqual(1.5);
      expect(contrast(label, slice)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(colour(theme.pieLegendTextColor), tokens.page),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("gantt task, active, done and critical bars are distinct, stand out from the page, and label legibly", () => {
    const bars = [
      theme.taskBkgColor,
      theme.activeTaskBkgColor,
      theme.doneTaskBkgColor,
      theme.critBkgColor,
    ].map(colour);
    expect(new Set(bars).size).toBe(4);
    for (const bar of bars) {
      expect(contrast(bar, tokens.page)).toBeGreaterThanOrEqual(1.5);
      for (const label of [theme.taskTextColor, theme.taskTextDarkColor])
        expect(contrast(colour(label), bar)).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrast(colour(theme.taskTextOutsideColor), tokens.page),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("mindmap branches have distinct colours with legible labels", () => {
    const root = colour(theme.git0);
    const branches = Array.from({ length: 11 }, (_, i) =>
      colour(theme[`cScale${i + 1}`]),
    );
    expect(new Set([root, ...branches]).size).toBe(12);
    expect(
      contrast(colour(theme.gitBranchLabel0), root),
    ).toBeGreaterThanOrEqual(4.5);
    branches.forEach((branch, i) => {
      expect(contrast(branch, tokens.page)).toBeGreaterThanOrEqual(1.5);
      expect(
        contrast(colour(theme[`cScaleLabel${i + 1}`]), branch),
      ).toBeGreaterThanOrEqual(4.5);
    });
  });
});
