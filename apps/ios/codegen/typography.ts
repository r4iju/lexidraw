import { fileURLToPath } from "node:url";
import { DOCUMENT_TABLE_LAYOUT } from "@packages/lexical-nodes/tables";
import postcss, { type Container } from "postcss";
import { theme } from "../../lexidraw/src/app/documents/[documentId]/themes/theme";

export const DOCUMENT_TYPOGRAPHY_PATH = fileURLToPath(
  new URL("../Sources/TextKitEditor/WebTypography.swift", import.meta.url),
);

const DOCUMENT_CSS_URL = new URL(
  "../../lexidraw/src/styles/document.css",
  import.meta.url,
);
const GLOBALS_CSS_URL = new URL(
  "../../lexidraw/src/styles/globals.css",
  import.meta.url,
);

/**
 * The web editor's stylesheets, the classes its theme gives a quote, a
 * selected rule and a selected table cell, and what it lays a table out by
 * besides them.
 */
export type WebStyles = {
  documentCSS: string;
  globalsCSS: string;
  quoteClass: string;
  ruleSelectedClass: string;
  tableCellSelectedClass: string;
  tableLayout: Record<keyof typeof DOCUMENT_TABLE_LAYOUT, number>;
};

export async function readWebStyles(): Promise<WebStyles> {
  return {
    documentCSS: await Bun.file(DOCUMENT_CSS_URL).text(),
    globalsCSS: await Bun.file(GLOBALS_CSS_URL).text(),
    quoteClass: theme.quote,
    ruleSelectedClass: theme.hrSelected,
    tableCellSelectedClass: theme.tableCellSelected,
    tableLayout: DOCUMENT_TABLE_LAYOUT,
  };
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
const HEADINGS = `:is(${HEADING_TAGS.join(", ")})`;
const NOT_IN_DECORATOR = ":not([data-lexical-decorator] *)";
const SHARED_HEADING = `.document-content ${HEADINGS}${NOT_IN_DECORATOR}`;

/**
 * How the web shows a document's blocks, read from its stylesheets, in
 * Swift for the iOS editor to lay blocks out as the web does. Lengths are
 * in ems of the text they apply to, except where they are in points, as
 * the web's pixels.
 */
export function swiftForTypography(styles: WebStyles): string {
  const css = postcss.parse(styles.documentCSS);
  const colors = new ThemeColors(postcss.parse(styles.globalsCSS));

  const content = declarations(css, ".document-content");
  const block = declarations(css, ".document-content > *");
  const [blockBefore, blockAfter] = pair(value(block, "margin-block"));
  const first = declarations(
    css,
    `.document-content > :first-child${NOT_IN_DECORATOR}`,
  );
  if (blockBefore !== "0" || value(first, "margin-block-start") !== "0") {
    throw new Error("A block has space before it, which isn't read yet");
  }
  const paragraph = declarations(css, `.document-content p${NOT_IN_DECORATOR}`);
  const [paragraphBefore, paragraphAfter] = pair(
    value(paragraph, "margin-block"),
  );
  if (
    resolve(paragraphBefore, paragraph) !== resolve(blockBefore, block) ||
    resolve(paragraphAfter, paragraph) !== resolve(blockAfter, block)
  ) {
    throw new Error(
      `${paragraph.selector} has other space than every block, which isn't read yet`,
    );
  }

  const heading = declarations(css, SHARED_HEADING);
  const [headingBefore, headingAfter] = pair(value(heading, "margin-block"));
  const headings = HEADING_TAGS.map((tag) => {
    const own = declarations(
      css,
      `.document-content ${tag}${NOT_IN_DECORATOR}`,
    );
    const or = (property: string, otherwise: () => string) =>
      own.values.get(property) ?? otherwise();
    const fields = [
      `fontSize: ${ems(value(own, "font-size"))}`,
      `lineHeight: ${number(value(own, "line-height"))}`,
      `letterSpacing: ${optional(
        ems,
        own.values.get("letter-spacing") ??
          heading.values.get("letter-spacing"),
      )}`,
      `before: ${ems(resolve(headingBefore, own))}`,
      `after: ${ems(resolve(headingAfter, own))}`,
      `color: ${colors.name(or("color", () => value(heading, "color")))}`,
    ];
    return `      .${tag}: Heading(${fields.join(", ")}),`;
  });
  const adjacent = declarations(
    css,
    `.document-content ${HEADINGS} + ${HEADINGS}${NOT_IN_DECORATOR}`,
  );
  const halved = /^calc\(var\(--heading-before\) \/ ([\d.]+)\)$/.exec(
    value(adjacent, "margin-block-start"),
  );
  if (!halved?.[1]) {
    throw new Error(
      "A heading after a heading has space before it as isn't read yet",
    );
  }

  const quote = declarations(css, `.${styles.quoteClass}`);
  const [quoteBorderWidth, quoteBorderColor] = border(
    value(quote, "border-inline-start"),
  );
  const [quotePaddingStart] = pair(value(quote, "padding-inline"));

  const list = declarations(
    css,
    `.document-content :is(ul, ol)${NOT_IN_DECORATOR}`,
  );
  const item = declarations(css, `.document-content li${NOT_IN_DECORATOR}`);
  refuseOtherThan(item, "margin-block", "0");
  const nextItem = declarations(
    css,
    `.document-content li + li${NOT_IN_DECORATOR}`,
  );
  const itemSpacing = value(nextItem, "margin-block-start");
  const nested = declarations(
    css,
    `.document-content li :is(ul, ol)${NOT_IN_DECORATOR}`,
  );
  const [nestedBefore, nestedAfter] = pair(value(nested, "margin-block"));
  if (nestedBefore !== itemSpacing || nestedAfter !== "0") {
    throw new Error(
      `${nested.selector} is spaced other than an item, which isn't read yet`,
    );
  }
  const marker = declarations(
    css,
    `.document-content li${NOT_IN_DECORATOR}::marker`,
  );
  const task = declarations(css, ".document-content li.document-task");
  const [taskPadding, taskPaddingEnd] = pair(value(task, "padding-inline"));
  if (taskPaddingEnd !== "0") {
    throw new Error(
      `${task.selector} has padding at its end, which isn't read yet`,
    );
  }
  const box = declarations(css, ".document-task::before");
  refuseOtherThan(box, "inset-inline-start", "0");
  if (value(box, "width") !== value(box, "height")) {
    throw new Error(`${box.selector} isn't square`);
  }
  const [boxBorderWidth, boxBorderColor] = border(value(box, "border"));
  const done = declarations(css, ".document-task-done");
  refuseOtherThan(done, "text-decoration", "line-through");
  const checked = declarations(css, ".document-task-done::before");
  if (value(checked, "background") !== value(checked, "border-color")) {
    throw new Error(`${checked.selector} is filled other than it's outlined`);
  }
  const tick = declarations(css, ".document-task-done::after");
  refuseOtherThan(tick, "transform", "rotate(45deg)");
  const tickColor = /^solid (.+)$/.exec(value(tick, "border"))?.[1];
  const tickLineWidth = /^0 (\S+) \1 0$/.exec(value(tick, "border-width"))?.[1];
  if (!tickColor || !tickLineWidth) {
    throw new Error(`${tick.selector} isn't a tick drawn as an L`);
  }
  const listFields = [
    `padding: ${ems(value(list, "padding-inline-start"))}`,
    `itemSpacing: ${ems(itemSpacing)}`,
    `markerColor: ${colors.name(value(marker, "color"))}`,
    `checklistPadding: ${ems(taskPadding)}`,
    `box: Box(top: ${ems(value(box, "top"))}, size: ${ems(value(box, "width"))}, ` +
      `borderWidth: ${points(boxBorderWidth)}, borderColor: ${colors.name(boxBorderColor)}, ` +
      `cornerRadius: ${points(value(box, "border-radius"))}, ` +
      `checkedColor: ${colors.name(value(checked, "background"))}, ` +
      `tick: Tick(left: ${ems(value(tick, "left"))}, top: ${ems(value(tick, "top"))}, ` +
      `width: ${ems(value(tick, "width"))}, height: ${ems(value(tick, "height"))}, ` +
      `lineWidth: ${points(tickLineWidth)}, color: ${colors.name(tickColor)}))`,
    `doneColor: ${colors.name(value(done, "color"))}`,
  ];

  const hr = declarations(css, ".document-content hr");
  const [ruleWidth, ruleColor] = border(value(hr, "border-top"));
  const [ruleBefore, ruleAfter] = pair(value(hr, "margin-block"));
  if (ruleBefore !== ruleAfter) {
    throw new Error("A rule has other space before it than after it");
  }
  const ruleSelected = declarations(css, `.${styles.ruleSelectedClass}`);
  const read = new Set(["outline", "outline-offset"]);
  for (const property of ruleSelected.values.keys()) {
    if (!read.has(property)) {
      throw new Error(
        `${ruleSelected.selector} sets ${property}, which isn't read yet`,
      );
    }
  }
  const [outlineWidth, outlineColor] = border(value(ruleSelected, "outline"));
  const outlineOffset = value(ruleSelected, "outline-offset");

  const link = declarations(css, ".document-link");
  const decoration = /^underline (\S+)$/.exec(value(link, "text-decoration"));
  const skipsInk = link.values.get("text-decoration-skip-ink") ?? "auto";
  if (!decoration?.[1] || skipsInk !== "auto") {
    throw new Error(`${link.selector} is underlined as isn't read yet`);
  }
  const underlineOffset = /^([\d.]+)em$/.exec(
    value(link, "text-underline-offset"),
  );
  if (!underlineOffset?.[1]) {
    throw new Error(`${link.selector}'s underline is offset as isn't read yet`);
  }
  const underline =
    /^color-mix\(in oklab, currentColor (\d+)%, transparent\)$/.exec(
      value(link, "text-decoration-color"),
    );
  if (!underline?.[1]) {
    throw new Error(
      `${link.selector}'s underline is coloured as isn't read yet`,
    );
  }

  const lines = [
    "// Generated by `bun run codegen` in apps/ios. Don't edit it.",
    "",
    "extension DocumentTypography {",
    "  /// document.css and globals.css in apps/lexidraw.",
    "  static let web = DocumentTypography(",
    `    color: ${colors.name(value(content, "color"))},`,
    `    lineHeight: ${number(value(content, "line-height"))},`,
    `    letterSpacing: ${ems(content.values.get("letter-spacing") ?? "0")},`,
    `    blockAfter: ${ems(resolve(blockAfter, block))},`,
    `    headingWeight: ${number(value(heading, "font-weight"))},`,
    "    headings: [",
    ...headings,
    "    ],",
    `    adjacentHeadingBefore: ${1 / number(halved[1])},`,
    `    narrow: [${swiftForNarrow(css).join(", ")}],`,
    `    languages: [${swiftForLanguages(css).join(", ")}],`,
    `    list: List(${listFields.join(", ")}),`,
    `    quote: Quote(borderWidth: ${points(quoteBorderWidth)}, borderColor: ${colors.name(quoteBorderColor)}, paddingStart: ${ems(quotePaddingStart)}),`,
    `    rule: Rule(width: ${points(ruleWidth)}, color: ${colors.name(ruleColor)}, margin: ${ems(ruleBefore)}, ` +
      `selected: Outline(width: ${points(outlineWidth)}, color: ${colors.name(outlineColor)}, offset: ${points(outlineOffset)})),`,
    `    link: Link(color: ${colors.name(value(link, "color"))}, underlineThickness: ${points(decoration[1])}, underlineOffset: ${number(underlineOffset[1])}, underlineOpacity: ${Number(underline[1]) / 100}),`,
    `    table: ${swiftForTable(css, colors, content, styles)})`,
    "}",
    "",
    "extension ThemeColor {",
    ...colors.used.map(
      ([name, light, dark]) =>
        `  static let ${name} = ThemeColor(light: ${swiftRGBA(light)}, dark: ${swiftRGBA(dark)})`,
    ),
    "}",
  ];
  return `${lines.join("\n")}\n`;

  /** `text` with each var() in it as `where` sets it, or else the content. */
  function resolve(text: string, where: Declarations): string {
    return text.replace(
      /var\((--[\w-]+)\)/g,
      (_, name: string) => where.values.get(name) ?? value(content, name),
    );
  }
}

/**
 * A table as `.document-table` and its region set it, with the tint of a
 * selected cell and the first column a narrow screen pins.
 */
function swiftForTable(
  css: postcss.Root,
  colors: ThemeColors,
  content: Declarations,
  { tableCellSelectedClass, tableLayout }: WebStyles,
): string {
  const table = declarations(css, ".document-table");
  const region = declarations(css, ".document-table-region");
  const inContent = declarations(
    css,
    ".document-content > .document-table-region",
  );
  const cell = declarations(css, ".document-table :is(td, th)");
  const header = declarations(css, ".document-table th");
  const [tableBorder, tableBorderColor] = border(value(table, "border"));
  const [cellBorder, cellBorderColor] = border(
    value(cell, "border-inline-end"),
  );
  if (
    cellBorder !== tableBorder ||
    cellBorderColor !== tableBorderColor ||
    value(cell, "border-block-end") !== value(cell, "border-inline-end")
  ) {
    throw new Error(
      "A cell's borders aren't the table's, which isn't read yet",
    );
  }
  const [paddingY, paddingX] = pair(value(cell, "padding"));
  const [regionBefore, regionAfter] = pair(value(inContent, "margin-block"));
  if (regionBefore !== regionAfter) {
    throw new Error("A table has other space before it than after it");
  }
  const leastWidth = /^min\(([\d.]+)rem, ([\d.]+)vw\)$/.exec(
    value(
      declarations(css, ".document-table :is(td, th):not([data-short])"),
      "min-width",
    ),
  );
  if (!leastWidth?.[1] || !leastWidth[2]) {
    throw new Error("A cell's least width isn't min(rem, vw)");
  }
  const empty = declarations(
    css,
    ".document-table :is(td, th):not(:has([data-lexical-text], [data-lexical-decorator]))",
  );
  if (value(cell, "vertical-align") !== "top") {
    throw new Error(
      "A cell's text isn't set at the top, where a cell without its own vertical-align draws it",
    );
  }
  if (value(table, "font-variant-numeric") !== "tabular-nums") {
    throw new Error("A table's figures aren't tabular, which isn't read yet");
  }
  const letterSpacing = value(table, "letter-spacing");
  const [shadowWidth] = pair(value(region, "background-size"));
  const shadow = declarations(css, ".document-table-region[data-scroll-left]");
  const fields = [
    `fontSize: ${points(value(table, "font-size")) / points(value(content, "font-size"))}`,
    `lineHeight: ${number(value(table, "line-height"))}`,
    `letterSpacing: ${letterSpacing === "normal" ? 0 : ems(letterSpacing)}`,
    "tabularFigures: true",
    `margin: ${ems(regionBefore)}`,
    `paddingX: ${points(paddingX)}`,
    `paddingY: ${points(paddingY)}`,
    `border: ${points(tableBorder)}`,
    `borderColor: ${colors.name(tableBorderColor)}`,
    `cornerRadius: ${points(value(table, "border-radius"))}`,
    `minimumWidth: ${rems(`${leastWidth[1]}rem`)}`,
    `minimumViewportShare: ${number(leastWidth[2]) / 100}`,
    `emptyWidth: ${rems(value(empty, "min-width"))}`,
    `headerBackground: ${colors.name(value(header, "background"))}`,
    `headerWeight: ${number(value(header, "font-weight"))}`,
    `selection: ${swiftForBackgroundClass(tableCellSelectedClass, colors)}`,
    `shadowWidth: ${points(shadowWidth)}`,
    `shadowColor: ${colors.name(value(shadow, "--table-shadow-left"))}`,
    `pinned: ${swiftForPinnedColumn(css, colors)}`,
    `unpinnedColumns: ${tableLayout.unpinnedColumns}`,
    `shortColumns: ${tableLayout.shortColumns}`,
    `scrollingColumns: ${tableLayout.scrollingColumns}`,
  ];
  return `Table(${fields.join(", ")})`;
}

/**
 * Tailwind's `bg-{colour}/{opacity}` for a colour of the theme: the
 * theme's `--{colour}` at that opacity.
 */
function swiftForBackgroundClass(text: string, colors: ThemeColors): string {
  const match = /^bg-([\w-]+)(?:\/(\d+))?$/.exec(text);
  if (!match?.[1] || !colors.has(`--${match[1]}`)) {
    throw new Error(`${text} isn't a background of the theme's colours`);
  }
  const color = colors.name(`var(--${match[1]})`);
  return match[2] ? `${color}.opacity(${number(match[2]) / 100})` : color;
}

/**
 * The first column a screen no wider than a width pins while the table
 * scrolls past it, where `DocumentTablesPlugin` sets `data-pin-first`.
 */
function swiftForPinnedColumn(css: postcss.Root, colors: ThemeColors): string {
  const pinned = '.document-table[data-pin-first="true"] tr';
  const media: postcss.AtRule[] = [];
  css.each((node) => {
    if (
      node.type === "atrule" &&
      node.name === "media" &&
      node.some(
        (child) =>
          child.type === "rule" &&
          child.selectors.some((selector) =>
            normalize(selector).includes(pinned),
          ),
      )
    ) {
      media.push(node);
    }
  });
  const widths = new Set(
    media.map(
      (rule) => /^screen and \(max-width: (\d+)px\)$/.exec(rule.params)?.[1],
    ),
  );
  const [width] = widths;
  if (widths.size !== 1 || !width) {
    throw new Error(
      "The pinned first column isn't under one @media screen and (max-width)",
    );
  }
  const within = (selector: string): Declarations => {
    const found = media.filter((rule) => has(rule, selector));
    const [first] = found;
    if (!first) throw new Error(`The stylesheet has no rule for ${selector}`);
    const values = new Map<string, string>();
    for (const rule of found) {
      for (const [property, text] of declarations(rule, selector).values) {
        values.set(property, text);
      }
    }
    return { selector, values };
  };
  const column = within(`${pinned} > :first-child`);
  const header = within(`${pinned} > th:first-child`);
  const shadow = /^(-?\d+px) 0 (\d+px) (-?\d+px) (.+)$/.exec(
    value(
      within(
        `.document-table-region[data-scroll-left] ${pinned} > :first-child`,
      ),
      "box-shadow",
    ),
  );
  if (!shadow?.[1] || !shadow[2] || !shadow[3] || !shadow[4]) {
    throw new Error("The pinned column's shadow isn't x 0 blur spread colour");
  }
  if (
    colors.name(shadow[4]) !==
    colors.name(
      value(
        declarations(css, ".document-table-region[data-scroll-left]"),
        "--table-shadow-left",
      ),
    )
  ) {
    throw new Error(
      "The pinned column's shadow isn't the scroll shadows' colour",
    );
  }
  const fields = [
    `width: ${number(width)}`,
    `inset: ${points(value(column, "left"))}`,
    `background: ${colors.name(value(column, "background-color"))}`,
    `headerBackground: ${colors.name(value(header, "background-color"))}`,
    `shadowX: ${points(shadow[1])}`,
    `shadowBlur: ${points(shadow[2])}`,
    `shadowSpread: ${points(shadow[3])}`,
  ];
  return `Pinned(${fields.join(", ")})`;
}

/**
 * Each narrow container's heading sizes, as `Narrow`s in the stylesheet's
 * order.
 */
function swiftForNarrow(css: postcss.Root): string[] {
  const narrow: string[] = [];
  css.walkAtRules("container", (container) => {
    const width = /^\(max-width: (\d+)px\)$/.exec(container.params)?.[1];
    const sizes = new Map<string, number>();
    container.each((node) => {
      if (node.type !== "rule") return;
      for (const selector of node.selectors.map(normalize)) {
        const tag = HEADING_TAGS.find(
          (tag) => selector === `.document-content ${tag}${NOT_IN_DECORATOR}`,
        );
        if (!tag && selector !== SHARED_HEADING) continue;
        const properties = (node.nodes ?? []).flatMap((child) =>
          child.type === "decl" ? [child.prop] : [],
        );
        if (
          !tag ||
          !width ||
          container.parent?.type !== "root" ||
          properties.some((property) => property !== "font-size")
        ) {
          throw new Error(
            `${selector} in @container ${container.params} sets ${properties.join(", ")} as isn't read yet`,
          );
        }
        const own = declarations(container, selector);
        sizes.set(tag, ems(value(own, "font-size")));
      }
    });
    if (width && sizes.size > 0) {
      const entries = [...sizes].map(([tag, size]) => `.${tag}: ${size}`);
      narrow.push(
        `Narrow(width: ${number(width)}, headingSizes: [${entries.join(", ")}])`,
      );
    }
  });
  return narrow;
}

/**
 * The body text the rules for a document in a language set, as `Language`s
 * in the stylesheet's order.
 */
function swiftForLanguages(css: postcss.Root): string[] {
  const languages: string[] = [];
  css.walkRules((rule) => {
    for (const selector of rule.selectors.map(normalize)) {
      if (
        !selector.startsWith(".document-content") ||
        !selector.includes(":lang(")
      ) {
        continue;
      }
      const own = new Map(
        (rule.nodes ?? []).flatMap((child) =>
          child.type === "decl" ? [[child.prop, child.value] as const] : [],
        ),
      );
      const lineHeight = own.get("line-height");
      const letterSpacing = own.get("letter-spacing");
      if (lineHeight === undefined && letterSpacing === undefined) continue;
      if (
        rule.parent?.type !== "root" ||
        !/^\.document-content(?::lang\([\w-]+\)|:is\((?::lang\([\w-]+\)(?:, )?)+\))$/.test(
          selector,
        )
      ) {
        throw new Error(
          `${selector} sets a language's line height or letter spacing as isn't read yet`,
        );
      }
      const tags = [...selector.matchAll(/:lang\(([\w-]+)\)/g)].map(
        ([, tag]) => `"${tag}"`,
      );
      languages.push(
        `Language(tags: [${tags.join(", ")}], lineHeight: ${optional(number, lineHeight)}, letterSpacing: ${optional(ems, letterSpacing)})`,
      );
    }
  });
  return languages;
}

/** What a selector's rules in a container set, later rules over earlier. */
type Declarations = { selector: string; values: Map<string, string> };

/**
 * What the rules in `container`, outside any at-rule in it, one of whose
 * selectors is `selector`, set.
 */
function declarations(container: Container, selector: string): Declarations {
  const values = new Map<string, string>();
  let found = false;
  container.each((node) => {
    if (
      node.type !== "rule" ||
      !node.selectors.map(normalize).includes(selector)
    ) {
      return;
    }
    found = true;
    node.each((child) => {
      if (child.type === "decl") values.set(child.prop, child.value);
    });
  });
  if (!found) throw new Error(`The stylesheet has no rule for ${selector}`);
  return { selector, values };
}

function has(container: Container, selector: string): boolean {
  return (
    container.nodes?.some(
      (node) =>
        node.type === "rule" &&
        node.selectors.map(normalize).includes(selector),
    ) ?? false
  );
}

function normalize(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

function value(where: Declarations, property: string): string {
  const found = where.values.get(property);
  if (found === undefined) {
    throw new Error(`${where.selector} sets no ${property}`);
  }
  return found;
}

/** Throws unless `where` sets `property` to `expected`, the one value read. */
function refuseOtherThan(
  where: Declarations,
  property: string,
  expected: string,
) {
  const found = value(where, property);
  if (found !== expected) {
    throw new Error(
      `${where.selector} sets ${property} to ${found} rather than ${expected}, which isn't read yet`,
    );
  }
}

/** A shorthand's start and end: one value is both. */
function pair(text: string): [string, string] {
  const parts = text.split(/\s+(?![^(]*\))/);
  const [start, end] = parts;
  if (!start || parts.length > 2) {
    throw new Error(`Not one or two values: ${text}`);
  }
  return [start, end ?? start];
}

/** A border's or an outline's width and colour, which must be solid. */
function border(text: string): [string, string] {
  const match = /^(\S+) solid (.+)$/.exec(text);
  if (!match?.[1] || !match[2]) throw new Error(`Not solid: ${text}`);
  return [match[1], match[2]];
}

/** `text` read by `read`, or Swift's nil for none. */
function optional(
  read: (text: string) => number,
  text: string | undefined,
): string {
  return text === undefined ? "nil" : `${read(text)}`;
}

function ems(text: string): number {
  if (text === "0") return 0;
  const match = /^(-?[\d.]+)em$/.exec(text);
  if (!match?.[1]) throw new Error(`Not in ems: ${text}`);
  return number(match[1]);
}

/** A browser's root font size, which the stylesheets leave as it is. */
const REM_POINTS = 16;

function rems(text: string): number {
  const match = /^([\d.]+)rem$/.exec(text);
  if (!match?.[1]) throw new Error(`Not in rems: ${text}`);
  return number(match[1]) * REM_POINTS;
}

function points(text: string): number {
  const match = /^(-?[\d.]+)px$/.exec(text);
  if (!match?.[1]) throw new Error(`Not in pixels: ${text}`);
  return number(match[1]);
}

function number(text: string): number {
  const parsed = Number(text);
  if (text === "" || Number.isNaN(parsed))
    throw new Error(`Not a number: ${text}`);
  return parsed;
}

type RGBA = [number, number, number, number];

/**
 * The theme's colours, light as `:root` sets them and dark as `.dark` on
 * the screen does, by the Swift name of the custom property each is.
 */
class ThemeColors {
  private readonly light = new Map<string, string>();
  private readonly dark = new Map<string, string>();
  readonly used: [string, RGBA, RGBA][] = [];

  constructor(css: postcss.Root) {
    this.collect(declarations(css, ":root"), this.light);
    css.each((node) => {
      if (
        node.type === "atrule" &&
        node.name === "media" &&
        node.params === "screen" &&
        has(node, ".dark")
      ) {
        this.collect(declarations(node, ".dark"), this.dark);
      }
    });
    if (this.dark.size === 0) {
      throw new Error("The stylesheet has no rule for .dark on the screen");
    }
  }

  private collect(from: Declarations, into: Map<string, string>) {
    for (const [property, value] of from.values) {
      if (property.startsWith("--")) into.set(property, value);
    }
  }

  has(property: string): boolean {
    return this.light.has(property);
  }

  /** The Swift name of the custom property `text` resolves to. */
  name(text: string): string {
    const property = this.property(text);
    const name = property
      .slice(2)
      .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (!this.used.some(([used]) => used === name)) {
      this.used.push([
        name,
        this.color(property, this.light),
        this.color(property, new Map([...this.light, ...this.dark])),
      ]);
    }
    return `.${name}`;
  }

  /** The first property of a var() and its fallbacks that the theme sets. */
  private property(text: string): string {
    const match = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(text.trim());
    if (!match?.[1]) throw new Error(`Not a theme colour: ${text}`);
    if (this.light.has(match[1])) return match[1];
    if (match[2]) return this.property(match[2]);
    throw new Error(`The theme sets no ${match[1]}`);
  }

  private color(property: string, values: Map<string, string>): RGBA {
    const text = values.get(property) ?? "";
    const reference = /^var\((--[\w-]+)\)$/.exec(text);
    if (reference?.[1]) return this.color(reference[1], values);
    const oklch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(
      text,
    );
    if (oklch) {
      const [l, c, h, alpha] = oklch
        .slice(1)
        .map((part) => (part === undefined ? 1 : Number(part)));
      return [...srgbForOklch(l ?? 0, c ?? 0, h ?? 0), alpha ?? 1];
    }
    throw new Error(`${property} is ${text}, which isn't read yet`);
  }
}

/**
 * A colour in OKLCH as gamma-encoded sRGB channels from 0 to 1, clipped to
 * sRGB as a browser shows it on an sRGB screen.
 */
export function srgbForOklch(
  l: number,
  c: number,
  h: number,
): [number, number, number] {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const encoded = linear.map((channel) => {
    const clipped = Math.min(Math.max(channel, 0), 1);
    return clipped <= 0.0031308
      ? 12.92 * clipped
      : 1.055 * clipped ** (1 / 2.4) - 0.055;
  });
  return encoded.map((channel) => Math.round(channel * 1e6) / 1e6) as [
    number,
    number,
    number,
  ];
}

function swiftRGBA([red, green, blue, alpha]: RGBA): string {
  const channel = (value: number) => (Math.round(value * 1e4) / 1e4).toString();
  return `RGBA(${channel(red)}, ${channel(green)}, ${channel(blue)}, ${channel(alpha)})`;
}
