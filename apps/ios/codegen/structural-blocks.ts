import postcss from "postcss";
import { ThemeColors, srgbForOklch } from "./typography";
import { createHeadlessEditor } from "@lexical/headless";
import { $createHorizontalRuleNode } from "@lexical/extension";
import { SCHEMA_NODES } from "@packages/lexical-nodes/nodes";
import {
  CalloutNode,
  CALLOUT_LABELS,
  CollapsibleContainerNode,
  CollapsibleTitleNode,
  CollapsibleContentNode,
  LayoutContainerNode,
  LayoutItemNode,
  PageBreakNode,
  StickyNode,
} from "@packages/lexical-nodes";
import {
  $createParagraphNode,
  $isElementNode,
  $isDecoratorNode,
  type LexicalNode,
} from "lexical";

export const STRUCTURAL_BLOCKS_PATH = new URL(
  "../Sources/LexidrawJSON/StructuralBlockConfiguration.swift",
  import.meta.url,
);
export async function swiftForStructuralBlocks(): Promise<string> {
  const insertMenu = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/plugins/ToolbarPlugin/insert-item.tsx",
      import.meta.url,
    ),
  ).text();
  const dividerLabel =
    /label: "([^"]+)",\s*icon: icon\(SeparatorHorizontal\),\s*insert: \(\) =>\s*editor\.dispatchCommand\(INSERT_HORIZONTAL_RULE_COMMAND, undefined\)/.exec(
      insertMenu,
    )?.[1];
  if (!dividerLabel) throw new Error("Web divider insertion changed shape");
  const globals = await Bun.file(
    new URL("../../lexidraw/src/styles/globals.css", import.meta.url),
  ).text();
  const document = await Bun.file(
    new URL("../../lexidraw/src/styles/document.css", import.meta.url),
  ).text();
  const dialog = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/plugins/LayoutPlugin/InsertLayoutDialog.tsx",
      import.meta.url,
    ),
  ).text();
  const theme = await Bun.file(new URL("../../lexidraw/src/app/documents/[documentId]/themes/theme.ts", import.meta.url)).text();
  const itemClasses = /layoutItem:\s*"([^"]+)"/.exec(theme)?.[1]?.split(/\s+/);
  const paddingClass = itemClasses?.find((value) => /^p-\d+$/.test(value));
  const knownItemClasses = new Set(["document-column", "border", "border-dashed", "border-muted", paddingClass,
    "[[aria-readonly=true]_&]:border-transparent", "print:border-transparent"]);
  if (!itemClasses || !paddingClass || itemClasses.length !== knownItemClasses.size ||
    itemClasses.some((value) => !knownItemClasses.has(value)))
    throw new Error("Column item utilities changed shape");
  const containerClasses = /layoutContainer:\s*"([^"]+)"/.exec(theme)?.[1]?.split(/\s+/);
  const gapClass = containerClasses?.find((value) => /^gap-\d+$/.test(value));
  const mutedAlias = /--muted:\s*var\((--[\w-]+)\);/.exec(globals)?.[1];
  const mutedValues = mutedAlias ? [...globals.matchAll(new RegExp(`${mutedAlias}: ([^;]+);`, "g"))].map((m) => m[1]) : [];
  if (!gapClass || containerClasses?.length !== 2 || !containerClasses.includes("grid") ||
    !itemClasses?.includes("border-dashed") || !itemClasses.includes("border-muted") ||
    !itemClasses.includes("[[aria-readonly=true]_&]:border-transparent") || itemClasses.some((value) => value.includes("rounded")) ||
    mutedValues.length !== 3 || mutedValues[1] !== mutedValues[2])
    throw new Error("Column gap/border theme changed shape");
  const themeColors = new ThemeColors(postcss.parse(globals));
  const rgbaColors = (name: string) => {
    const resolvedName = themeColors.name(`var(--${name})`).slice(1);
    const pair = themeColors.used.find(([used]) => used === resolvedName);
    if (!pair) throw new Error(`No resolved structural color ${name}`);
    return [pair[1], pair[2]].map(([r, g, b, alpha]) => {
      return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${alpha})`;
    });
  };
  const columnBorderColors = rgbaColors("muted");
  const spacingCSS = await Bun.file(new URL("../../lexidraw/node_modules/tailwindcss/theme.css", import.meta.url)).text();
  const spacingRem = /--spacing:\s*([\d.]+)rem;/.exec(spacingCSS)?.[1];
  const itemContainment = /\.document-content :is\(\[data-lexical-layout-item\], \.document-column\) \{([^}]+)\}/.exec(document)?.[1];
  if (!paddingClass || !spacingRem || !itemClasses?.includes("border") ||
    !itemContainment?.includes("min-width: 0;") || !itemContainment.includes("container-type: inline-size;"))
    throw new Error("Column box/containment CSS changed shape");
  // Tailwind's rem utilities use the browser's 16px root, as existing native structural utilities do.
  const columnPadding = Number(paddingClass.slice(2)) * Number(spacingRem) * 16;
  const tailwind = await import(Bun.resolveSync("tailwindcss", new URL("../../lexidraw/", import.meta.url).pathname));
  if (typeof tailwind.compile !== "function") throw new Error("Tailwind compiler API changed shape");
  const compiler = await tailwind.compile(`@theme { --spacing: ${spacingRem}rem; } @tailwind utilities;`);
  const boxCSS: string = compiler.build(["border", paddingClass, gapClass]);
  const border = /\.border \{[^}]*border-width: ([\d.]+)px;/.exec(boxCSS)?.[1];
  if (!border || !boxCSS.includes(`padding: calc(var(--spacing) * ${paddingClass.slice(2)});`))
    throw new Error("Tailwind column box utilities changed shape");
  if (!boxCSS.includes(`gap: calc(var(--spacing) * ${gapClass.slice(4)});`))
    throw new Error("Tailwind column gap utility changed shape");
  const columnGap = Number(gapClass.slice(4)) * Number(spacingRem) * 16;
  const columnBorderWidth = Number(border);
  const layoutPlugin = await Bun.file(new URL("../../lexidraw/src/app/documents/[documentId]/plugins/LayoutPlugin/LayoutPlugin.tsx", import.meta.url)).text();
  const columnWhitespace = /template\.trim\(\)\.split\(\/([^/]+)\/\)\.length/.exec(layoutPlugin)?.[1];
  if (!columnWhitespace) throw new Error("Layout column counting changed shape");
  const layouts = [
    ...dialog.matchAll(/\{ label: "([^"]+)", value: "([^"]+)" \}/g),
  ].map((m) => {
    const label = m[1],
      value = m[2];
    if (!label || !value) throw new Error("Empty web column preset");
    return { label, value };
  });
  if (layouts.length !== 5)
    throw new Error("The web column presets changed shape");
  const colors = (name: string) => {
    const values = [
      ...globals.matchAll(new RegExp(`--${name}: ([^;]+);`, "g")),
    ].map((m) => {
      const value = m[1];
      if (!value) throw new Error(`Empty web ${name} color`);
      return value;
    });
    if (values.length !== 2)
      throw new Error(`The web ${name} theme colors changed shape`);
    return values;
  };
  const cssRoot = postcss.parse(globals);
  const stickyDefaults = cssRoot.nodes.find((node) => node.type === "atrule" && node.name === "theme" && node.params === "");
  let stickyDark: postcss.Rule | undefined;
  cssRoot.walkRules(".dark .sticky-note-container", (rule) => {
    if (stickyDark || rule.parent?.type !== "atrule" || rule.parent.name !== "media" || rule.parent.params !== "screen")
      throw new Error("Sticky dark palette scope changed shape");
    stickyDark = rule;
  });
  if (!stickyDefaults || stickyDefaults.type !== "atrule" || !stickyDark) throw new Error("Sticky palette scopes changed shape");
  const stickyPalette = (name: string) => [stickyDefaults, stickyDark].map((scope) => {
    const literals: string[] = [];
    scope?.walkDecls(`--color-sticky-${name}`, (declaration) => { literals.push(declaration.value); });
    if (literals.length !== 1) throw new Error(`Sticky ${name} palette changed shape`);
    const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(literals[0] ?? "");
    if (!match) throw new Error(`Unsupported sticky ${name} color: ${literals[0]}`);
    const l = Number(match[1]), c = Number(match[2]), h = Number(match[3]), alpha = Number(match[4] ?? 1);
    if (![l, c, h, alpha].every(Number.isFinite)) throw new Error(`Invalid sticky ${name} channels`);
    const [r, g, b] = srgbForOklch(l, c, h);
    return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${Math.max(0, Math.min(1, alpha))})`;
  });
  const callout = /\.callout \{([\s\S]*?)\}/.exec(document)?.[1] ?? "";
  const radius = /border-radius: (\d+)px/.exec(callout)?.[1];
  const padding = /padding: (\d+)px (\d+)px/.exec(callout);
  if (!radius || !padding)
    throw new Error("The callout geometry changed shape");
  const calloutHeader = /\.callout-header \{([\s\S]*?)\}/.exec(document)?.[1] ?? "";
  const calloutIcon = /\.callout-icon \{([\s\S]*?)\}/.exec(document)?.[1] ?? "";
  const header = {
    gap: /gap: (\d+)px/.exec(calloutHeader)?.[1],
    after: /margin-bottom: (\d+)px/.exec(calloutHeader)?.[1],
    weight: /font-weight: (\d+)/.exec(calloutHeader)?.[1],
    lineHeight: /line-height: ([\d.]+)/.exec(calloutHeader)?.[1],
    icon: /width: (\d+)px/.exec(calloutIcon)?.[1],
  };
  if (
    Object.values(header).some((value) => value === undefined) ||
    !/color: var\(--callout\)/.test(calloutHeader) ||
    !/\.callout-body \{[^}]*color: var\(--foreground\)/.test(document)
  )
    throw new Error("The callout header changed shape");
  // The icons are Lucide's, named in a comment beside each kind's mask.
  const calloutIcons = Object.keys(CALLOUT_LABELS).map((kind) => {
    const name = new RegExp(
      `\\.callout\\[data-callout-kind="${kind}"\\] \\{[^}]*?/\\* Lucide ([\\w-]+) \\*/`,
    ).exec(document)?.[1];
    if (!name) throw new Error(`The ${kind} callout icon changed shape`);
    return [kind, name] as const;
  });
  const nodeSource = (name: string) =>
    Bun.file(new URL(`../../../packages/lexical-nodes/src/nodes/${name}.ts`, import.meta.url)).text();
  const containerSource = await Bun.file(
    new URL("../../../packages/lexical-nodes/src/nodes/CollapsibleContainerNode.ts", import.meta.url),
  ).text();
  const toggleRule = (selector: string) => {
    const rule = new RegExp(`\\.document-content ${selector.replace(/[[\]().*]/g, "\\$&")} \\{([^}]*)\\}`).exec(document)?.[1];
    if (!rule) throw new Error(`The toggle's ${selector} rule changed shape`);
    return rule;
  };
  const gutter = /--toggle-gutter: ([\d.]+)em;/.exec(toggleRule(`[data-slot="accordion-item"]`))?.[1];
  const chevronBox = /width: calc\(([\d.]+)em \+ ([\d.]+)rem\);\s*height: calc\(\1em \+ \2rem\);\s*padding: ([\d.]+)rem;/
    .exec(toggleRule(`[data-slot="accordion-chevron"] svg`));
  const contentGap = /margin-block-start: ([\d.]+)em;/.exec(toggleRule(`[data-slot="accordion-content"] > :first-child`))?.[1];
  if (!gutter || !chevronBox || !contentGap || !/height: 1lh;/.test(toggleRule(`[data-slot="accordion-chevron"]`)) ||
    !/color: var\(--muted-foreground\);/.test(toggleRule(`[data-slot="accordion-chevron"]`)) ||
    !/rotate: 90deg;/.test(toggleRule(`[data-state="open"] > [data-slot="accordion-chevron"] svg`)))
    throw new Error("The toggle's geometry changed shape");
  // A toggle heading's chevron takes the heading's size and leading, as a
  // paragraph's takes the document's.
  const documentLineHeight = /\.document-header \{[^}]*line-height: ([\d.]+);/.exec(document)?.[1];
  if (!documentLineHeight) throw new Error("The document's line height changed shape");
  const levels: [string, number, number][] = [["paragraph", 1, Number(documentLineHeight)]];
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    const rule = new RegExp(
      `> \\[data-slot="accordion-trigger"\\] > ${tag}\\)\\s*> \\[data-slot="accordion-chevron"\\] \\{\\s*font-size: ([\\d.]+)em;\\s*line-height: ([\\d.]+);`,
    ).exec(document);
    if (!rule) throw new Error(`The ${tag} toggle's chevron changed shape`);
    levels.push([tag, Number(rule[1]), Number(rule[2])]);
  }
  const chevronSVG = /<svg ([^>]*)><path d="([^"]+)"><\/path><\/svg>/.exec(containerSource);
  const chevronViewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(chevronSVG?.[1] ?? "");
  const chevronStroke = /stroke-width="([\d.]+)"/.exec(chevronSVG?.[1] ?? "")?.[1];
  const chevronOffsets = /^m([\d.\s-]+)$/.exec(chevronSVG?.[2] ?? "")?.[1]?.match(/-?[\d.]+/g)?.map(Number);
  if (!chevronViewBox || chevronViewBox[1] !== chevronViewBox[2] || !chevronStroke || !chevronOffsets ||
    chevronOffsets.length < 4 || chevronOffsets.length % 2 !== 0 ||
    !chevronSVG?.[1]?.includes('stroke-linecap="round"') || !chevronSVG[1]?.includes('stroke-linejoin="round"'))
    throw new Error("Collapsible chevron icon changed shape");
  // A relative moveto's further pairs are relative linetos.
  const chevronPoints: [number, number][] = [];
  for (let index = 0; index < chevronOffsets.length; index += 2) {
    const [x, y] = chevronPoints.at(-1) ?? [0, 0];
    const dx = chevronOffsets[index];
    const dy = chevronOffsets[index + 1];
    if (dx === undefined || dy === undefined) throw new Error("Collapsible chevron coordinates changed shape");
    chevronPoints.push([x + dx, y + dy]);
  }
  const section = {
    gutter: Number(gutter),
    chevronEm: Number(chevronBox[1]),
    chevronRem: Number(chevronBox[2]),
    chevronInset: Number(chevronBox[3]),
    contentGap: Number(contentGap),
    levels,
    chevronViewBox: Number(chevronViewBox[1]),
    chevronStrokeWidth: Number(chevronStroke),
    chevronPoints,
  };
  const stickySource = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/nodes/StickyComponent.tsx",
      import.meta.url,
    ),
  ).text();
  const stickyWidth = /available - (\d+)/.exec(stickySource)?.[1];
  const stickyClasses = /w-(\d+) h-(\d+) p-(\d+)/.exec(stickySource);
  if (
    !stickyWidth ||
    !stickyClasses ||
    Number(stickyClasses[1]) * 4 !== Number(stickyWidth)
  )
    throw new Error("Sticky geometry changed shape");
  const stackWidth =
    /@container \(max-width: (\d+)px\) \{\s*\.document-content \[data-lexical-layout-container\]/.exec(
      document,
    )?.[1];
  if (!stackWidth)
    throw new Error("The web structural geometry changed shape");
  const firstLayout = layouts[0];
  if (!firstLayout) throw new Error("No web column presets");
  const nodes: Record<string, unknown> = {};
  const isolated: string[] = [];
  const editor = createHeadlessEditor({
    nodes: SCHEMA_NODES,
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      const c = CalloutNode.$createCalloutNode("note");
      c.append($createParagraphNode());
      const section =
        CollapsibleContainerNode.$createCollapsibleContainerNode(false);
      section.append(
        CollapsibleTitleNode.$createCollapsibleTitleNode().append(
          $createParagraphNode(),
        ),
        CollapsibleContentNode.$createCollapsibleContentNode().append(
          $createParagraphNode(),
        ),
      );
      const layout = LayoutContainerNode.$createLayoutContainerNode(
        firstLayout.value,
      );
      layout.append(
        LayoutItemNode.$createLayoutItemNode().append($createParagraphNode()),
        LayoutItemNode.$createLayoutItemNode().append($createParagraphNode()),
      );
      for (const node of [
        $createHorizontalRuleNode(),
        c,
        section,
        layout,
        PageBreakNode.$createPageBreakNode(),
        new StickyNode(),
      ]) {
        nodes[node.getType()] = node.exportJSON();
        if ($isDecoratorNode(node) && node.isIsolated())
          isolated.push(node.getType());
      }
      // Element exportJSON omits reconciled children; editor-state export visits them.
      const serialize = (node: LexicalNode): unknown =>
        $isElementNode(node)
          ? {
              ...node.exportJSON(),
              children: node.getChildren().map(serialize),
            }
          : node.exportJSON();
      nodes.callout = serialize(c);
      nodes["collapsible-container"] = serialize(section);
      nodes["layout-container"] = serialize(layout);
    },
    { discrete: true },
  );
  const string = (value: string) => JSON.stringify(value);
  return `// Generated from structural node factories, web presets and document CSS.\n// Run bun run codegen in apps/ios to update.\npublic enum StructuralBlockConfiguration {\n  public static let columnGap = ${columnGap}.0\n  public static let columnBorderColors = ${JSON.stringify(columnBorderColors)}\n  public static let columnPadding = ${columnPadding}.0\n  public static let columnBorderWidth = ${columnBorderWidth}.0\n  public static let columnWhitespacePattern = ${JSON.stringify(columnWhitespace)}\n  public static let isolatedNodeTypes: Set<String> = [${isolated.map(string).join(", ")}]\n  public static let stickyWidth = ${stickyWidth}.0\n  public static let stickyHeight = ${Number(stickyClasses[2]) * 4}.0\n  public static let stickyPadding = ${Number(stickyClasses[3]) * 4}.0\n  public static let stackedColumnsWidth = ${stackWidth}.0\n  public static let calloutLabels: [String:String] = [${Object.entries(
    CALLOUT_LABELS,
  )
    .map(([k, v]) => `${string(k)}: ${string(v)}`)
    .join(
      ", ",
    )}]\n  public static let calloutColors: [String:[String]] = [${Object.keys(
    CALLOUT_LABELS,
  )
    .map(
      (k) => `${string(k)}: [${colors(`callout-${k}`).map(string).join(", ")}]`,
    )
    .join(", ")}]\n  public static let calloutTint = [${colors("callout-tint")
    .map((v) => Number.parseFloat(v) / 100)
    .join(
      ", ",
    )}]\n  public static let calloutRadius = ${radius}.0\n  public static let calloutPaddingY = ${padding[1]}.0\n  public static let calloutPaddingX = ${padding[2]}.0\n  public static let calloutHeaderGap = ${header.gap}.0\n  public static let calloutHeaderAfter = ${header.after}.0\n  public static let calloutHeaderWeight = ${header.weight}.0\n  public static let calloutHeaderLineHeight = ${header.lineHeight}\n  public static let calloutIconSize = ${header.icon}.0\n  /// Lucide icon names by kind.\n  public static let calloutIcons: [String:String] = [${calloutIcons.map(([k, v]) => `${string(k)}: ${string(v)}`).join(", ")}]\n  /// A toggle's chevron column, in ems of the document's text.\n  public static let sectionGutter = ${section.gutter}\n  /// The chevron's box: ems of its line's text plus ems of the document's, inset by the latter.\n  public static let sectionChevronEm = ${section.chevronEm}\n  public static let sectionChevronRem = ${section.chevronRem}\n  public static let sectionChevronInset = ${section.chevronInset}\n  public static let sectionContentGap = ${section.contentGap}\n  /// A title's text size and leading by its block, in ems of the document's text.\n  public static let sectionLevels: [String: (fontSize: Double, lineHeight: Double)] = [${section.levels.map(([tag, size, leading]) => `${string(tag)}: (${size}, ${leading})`).join(", ")}]\n  public static let sectionChevronColors = ${JSON.stringify(rgbaColors("muted-foreground"))}\n  public static let sectionChevronViewBox = ${section.chevronViewBox}.0\n  public static let sectionChevronStrokeWidth = ${section.chevronStrokeWidth}.0\n  public static let sectionChevronPoints: [(x: Double, y: Double)] = [${section.chevronPoints.map(([x, y]) => `(${x}.0, ${y}.0)`).join(", ")}]\n  public static let layouts: [(label: String, value: String)] = [${layouts.map((v) => `(${string(v.label)}, ${string(v.value)})`).join(", ")}]\n  public static let stickyColors: [String:[String]] = [${["pink", "yellow", "green", "blue", "red", "orange", "purple", "gray"].map((k) => `${string(k)}: [${stickyPalette(k).map(string).join(", ")}]`).join(", ")}]\n  public static let dividerLabel = ${string(dividerLabel)}\n  public static let insertionNodes: [String:String] = [${Object.entries(
    nodes,
  )
    .map(([k, v]) => `${string(k)}: #"${JSON.stringify(v)}"#`)
    .join(",\n    ")}]\n}\n`;
}
