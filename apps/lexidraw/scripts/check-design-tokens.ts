import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dir, "../src");
const palette =
  /\b(?:bg|text|border|ring|outline|fill|stroke|accent|caret|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})\b|\b(?:bg|text|border|ring|outline|fill|stroke)-(?:white|black)\b/;
const literalColour = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/i;
// These values describe authored media, colour-picker data, or third-party SVG selectors.
// They are not app chrome. Class names are still checked in these files.
const colourData = [
  "components/colorful/",
  "components/ui/color-picker.tsx",
  "components/ui/chart.tsx",
  "app/documents/[documentId]/context/toolbar-context.tsx",
  "app/documents/[documentId]/nodes/SlideNode/SlideDeckEditor.tsx",
  "app/documents/[documentId]/plugins/LlmChatPlugin/tools/",
  "app/documents/[documentId]/plugins/export-webp.ts",
  "app/drawings/[drawingId]/board-view.tsx",
  "server/",
  "lib/schemas.ts",
  "app/screenshot/",
  "app/layout.tsx",
  "app/opengraph-image.tsx",
];
// Motion animates colour, opacity or transform only, on the duration and easing tokens.
const motionProperties = new Set([
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
]);
const durationToken =
  /^var\(--transition-duration-(?:fast|base|moderate|slow)\)$/;
let failures = 0;
const requested = process.argv.slice(2);
const files = requested.length
  ? requested
  : await Array.fromAsync(
      new Bun.Glob("**/*.{ts,tsx,css}").scan({ cwd: root, absolute: true }),
    );
for (const file of files) {
  if (/\.(test|spec)\.|\.test-d\./.test(file)) continue;
  const path = relative(root, file);
  if (path === "styles/globals.css") continue;
  const source = await readFile(file, "utf8");
  function report(position: number, message: string) {
    const line = source.slice(0, position).split("\n").length;
    console.log(`${file}:${line}: ${message}`);
    failures++;
  }
  function checkClasses(value: string, position: number) {
    if (palette.test(value))
      report(position, "raw colour: use a semantic token");
    const classes = value.split(/\s+/);
    const colours = classes.filter((c) =>
      /(?:^|:)border-(?:[xytrblse]-)?(?:comment-border|border(?:-subtle)?|input|ring|foreground|muted(?:-foreground)?|primary|secondary|accent|destructive|success|warning|info|transparent|current|paper-white|paper-ink|\(--)/.test(
        c,
      ),
    );
    for (const c of classes) {
      const utility = c.slice(c.lastIndexOf(":") + 1);
      if (
        /^transition(?:-all|-shadow)?$/.test(utility) ||
        (/^transition-\[/.test(utility) &&
          !utility
            .slice(12, -1)
            .split(",")
            .every((property) => motionProperties.has(property)))
      )
        report(
          position,
          `transition: \`${c}\` should animate colour, opacity or transform only`,
        );
      if (/^duration-(?:[1-9]\d*|\[)/.test(utility))
        report(
          position,
          `duration: \`${c}\` should be fast, base, moderate or slow`,
        );
      if (
        /^ease-(?:in|out|in-out|\[)/.test(utility) &&
        !/^ease-(?:enter|exit)$/.test(utility)
      )
        report(position, `easing: \`${c}\` should be ease-enter or ease-exit`);
    }
    for (const c of classes) {
      if (
        !/(?:^|:)border(?:-[xytrblse])?(?:-(?:[1-9]\d*|\[[\d.]+px\]))?$/.test(c)
      )
        continue;
      const prefix = c.slice(0, c.lastIndexOf(":") + 1);
      if (
        !colours.some(
          (colour) => colour.startsWith(prefix) || !colour.includes(":"),
        )
      ) {
        report(position, `border colour: ${c} needs an explicit token`);
        break;
      }
    }
  }
  if (file.endsWith(".css")) {
    const declarations = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    );
    for (const match of declarations.matchAll(
      /([\w-]+)\s*:\s*([^;{}]+)[;}]?/g,
    )) {
      if (literalColour.test(match[2] ?? ""))
        report(match.index, "raw colour: use a semantic token");
      if (
        /^border(?:-[trbl]|-top|-right|-bottom|-left)?$/.test(match[1] ?? "") &&
        /\bsolid\b/.test(match[2] ?? "") &&
        !/var\(|transparent|currentColor/.test(match[2] ?? "")
      )
        report(match.index, "border colour: use a semantic token");
      if (match[1] === "transition" && match[2]?.trim() !== "none")
        for (const transition of match[2]?.split(/,(?![^(]*\))/) ?? []) {
          const [property, ...timing] = transition
            .trim()
            .split(/\s+(?![^(]*\))/);
          if (!property || !motionProperties.has(property))
            report(
              match.index,
              `transition: \`${transition.trim()}\` should name colour, opacity or transform`,
            );
          if (timing[0] && !durationToken.test(timing[0]))
            report(
              match.index,
              `duration: \`${timing[0]}\` should be a --transition-duration token`,
            );
        }
    }
    continue;
  }
  // Read literals rather than lines so multiline classes and variant groups stay together.
  const literals =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  for (const match of source.matchAll(literals)) {
    if (match[0].startsWith("/")) continue;
    const value = match[0].slice(1, -1);
    if (
      value.startsWith("@radix-ui/react-icons") ||
      value.startsWith("react-icons")
    )
      report(match.index, "Lucide is the app icon family");
    if (
      !/classList\.remove\([^)]*$/.test(
        source.slice(Math.max(0, match.index - 150), match.index),
      )
    )
      checkClasses(value, match.index);
    if (
      literalColour.test(value) &&
      !colourData.some((prefix) => path.startsWith(prefix))
    )
      report(match.index, "raw colour: use a semantic token");
  }
}
if (failures) process.exit(1);
console.log("Design tokens: passed");
