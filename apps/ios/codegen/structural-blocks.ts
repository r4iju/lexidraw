import { EMPTY_CONTENT, CHART_TYPES } from "@packages/lexical-nodes";
import { createHeadlessEditor } from "@lexical/headless";
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
  SlideNode,
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
  const boxCSS: string = compiler.build(["border", paddingClass]);
  const border = /\.border \{[^}]*border-width: ([\d.]+)px;/.exec(boxCSS)?.[1];
  if (!border || !boxCSS.includes(`padding: calc(var(--spacing) * ${paddingClass.slice(2)});`))
    throw new Error("Tailwind column box utilities changed shape");
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
  const callout = /\.callout \{([\s\S]*?)\}/.exec(document)?.[1] ?? "";
  const radius = /border-radius: (\d+)px/.exec(callout)?.[1];
  const padding = /padding: (\d+)px (\d+)px/.exec(callout);
  if (!radius || !padding)
    throw new Error("The callout geometry changed shape");
  const slideView = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/nodes/SlideNode/SlideView.tsx",
      import.meta.url,
    ),
  ).text();
  const deckEditor = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/nodes/SlideNode/SlideDeckEditor.tsx",
      import.meta.url,
    ),
  ).text();
  const resizeMinimum = /const minW = (\d+),\s*minH = (\d+);/.exec(deckEditor);
  if (!resizeMinimum) throw new Error("Slide resize minima changed shape");
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
  const slideElements: Record<string, unknown> = {};
  for (const [kind, name] of [
    ["box", "newBoxElement"],
    ["chart", "newChartElement"],
    ["image", "newImageElement"],
  ] as const) {
    const literal = new RegExp(
      `const ${name}: SlideElementSpec = {([\\s\\S]*?)\\n    };`,
    ).exec(deckEditor)?.[1];
    if (!literal) throw new Error(`Slide ${kind} defaults changed shape`);
    const fields: Record<string, unknown> = {};
    for (const line of literal.trim().split("\n")) {
      const pair = /^\s*(\w+): (.+?),\s*(?:\/\/.*)?$/.exec(line);
      if (!pair) throw new Error(`Unexpected slide default property: ${line}`);
      const key = pair[1];
      const value = pair[2];
      if (!key || !value) throw new Error("Empty slide property");
      if (
        key === "id" &&
        value === `new${kind.charAt(0).toUpperCase() + kind.slice(1)}Id`
      ) {
        fields[key] = "__id__";
        continue;
      }
      if (
        key === "zIndex" &&
        value === "getNextZIndex(currentSlide.elements)"
      ) {
        fields[key] = 0;
        continue;
      }
      if (
        key === "editorStateJSON" &&
        value === "EMPTY_CONTENT_FOR_NEW_BOXES"
      ) {
        fields[key] = EMPTY_CONTENT;
        continue;
      }
      if (key === "url" && value === "payload.src") {
        fields[key] = "";
        continue;
      }
      const fallback = /^(?:payload.width|payload.height) \|\| (\d+)$/.exec(
        value,
      )?.[1];
      fields[key] = JSON.parse(fallback ?? value);
    }
    if (fields.kind !== kind) throw new Error("Slide default kind changed");
    slideElements[kind] = fields;
  }
  const designWidth = /const DESIGN_WIDTH = (\d+);/.exec(slideView)?.[1];
  const canvas = /w-\[(\d+)px\] h-\[(\d+)px\]/.exec(deckEditor);
  const stackWidth =
    /@container \(max-width: (\d+)px\) \{\s*\.document-content \[data-lexical-layout-container\]/.exec(
      document,
    )?.[1];
  if (!designWidth || !canvas || designWidth !== canvas[1] || !stackWidth)
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
        c,
        section,
        layout,
        PageBreakNode.$createPageBreakNode(),
        new StickyNode(),
        SlideNode.$createSlideNode(),
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
  return `// Generated from structural node factories, web presets and document CSS.\n// Run bun run codegen in apps/ios to update.\npublic enum StructuralBlockConfiguration {\n  public static let columnPadding = ${columnPadding}.0\n  public static let columnBorderWidth = ${columnBorderWidth}.0\n  public static let columnWhitespacePattern = ${JSON.stringify(columnWhitespace)}\n  public static let isolatedNodeTypes: Set<String> = [${isolated.map(string).join(", ")}]\n  public static let stickyWidth = ${stickyWidth}.0\n  public static let stickyHeight = ${Number(stickyClasses[2]) * 4}.0\n  public static let stickyPadding = ${Number(stickyClasses[3]) * 4}.0\n  public static let chartTypes: [String] = [${CHART_TYPES.map(string).join(", ")}]\n  public static let slideElements: [String:String] = [${Object.entries(
    slideElements,
  )
    .map(([kind, fields]) => `${string(kind)}: #"${JSON.stringify(fields)}"#`)
    .join(
      ", ",
    )} ]\n  public static let slideMinimumWidth = ${resizeMinimum[1]}.0\n  public static let slideMinimumHeight = ${resizeMinimum[2]}.0\n  public static let slideWidth = ${designWidth}.0\n  public static let slideHeight = ${canvas[2]}.0\n  public static let stackedColumnsWidth = ${stackWidth}.0\n  public static let calloutLabels: [String:String] = [${Object.entries(
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
    )}]\n  public static let calloutRadius = ${radius}.0\n  public static let calloutPaddingY = ${padding[1]}.0\n  public static let calloutPaddingX = ${padding[2]}.0\n  public static let layouts: [(label: String, value: String)] = [${layouts.map((v) => `(${string(v.label)}, ${string(v.value)})`).join(", ")}]\n  public static let stickyColors: [String:[String]] = [${["pink", "yellow", "green", "blue", "red", "orange", "purple", "gray"].map((k) => `${string(k)}: [${colors(`color-sticky-${k}`).map(string).join(", ")}]`).join(", ")}]\n  public static let insertionNodes: [String:String] = [${Object.entries(
    nodes,
  )
    .map(([k, v]) => `${string(k)}: #"${JSON.stringify(v)}"#`)
    .join(",\n    ")}]\n}\n`;
}
