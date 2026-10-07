import postcss from "postcss";
import { ThemeColors, swiftRGBA } from "./typography";
import { createHeadlessEditor } from "@lexical/headless";
import emojiList from "../../../packages/lexical-nodes/src/emoji-list";
import { ArticleNode, PollNode, CommentNode, ThreadNode } from "@packages/lexical-nodes";
import { CommentStore } from "../../lexidraw/src/app/documents/[documentId]/commenting";
import { swiftString } from "./swift";

export const EMOJI_ALIASES_PATH = new URL(
  "../Sources/LexicalSwift/WebEmojiAliases.swift",
  import.meta.url,
);

export const POLL_STYLE_PATH = new URL(
  "../Sources/TextKitEditor/WebPollStyle.swift",
  import.meta.url,
);

export async function swiftForPollStyle(): Promise<string> {
  const source = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/nodes/PollComponent.tsx",
      import.meta.url,
    ),
  ).text();
  const widths = [...source.matchAll(/max-w-\[(\d+)px\]/g)];
  const minimum = source.match(/disabled=\{options\.length < (\d+)\}/);
  if (widths.length !== 1 || !minimum?.[1])
    throw new Error("Unknown poll card width or minimum-options shape");
  const plugin = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/plugins/PollPlugin/index.tsx",
      import.meta.url,
    ),
  ).text();
  const initialOptions = plugin.match(
    /PollNode\.\$createPollNode\(payload, \[([\s\S]*?)\]\)/,
  )?.[1];
  if (
    !initialOptions ||
    initialOptions
      .replace(/PollNode\.createPollOption\(\),?\s*/g, "")
      .trim() !== ""
  )
    throw new Error("Unknown poll insertion options shape");
  const count = [...initialOptions.matchAll(/PollNode\.createPollOption\(\)/g)]
    .length;
  const option = { ...PollNode.createPollOption(), uid: "" };
  let insertionNodeJSON = "";
  const editor = createHeadlessEditor({
    nodes: [PollNode],
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      const options = Array.from({ length: count }, () => ({
        ...PollNode.createPollOption(),
        uid: "",
      }));
      insertionNodeJSON = JSON.stringify(
        PollNode.$createPollNode("", options).exportJSON(),
      );
    },
    { discrete: true },
  );
  return `// Generated from the web PollComponent and PollNode by apps/ios/codegen/social.ts.\n\nenum WebPollStyle {\n  static let maximumWidth: Double = ${Number(widths[0]?.[1])}\n  static let minimumOptions = ${Number(minimum[1]) - 1}\n  static let emptyOptionJSON = ${swiftString(JSON.stringify(option))}\n  static let insertionNodeJSON = ${swiftString(insertionNodeJSON)}\n}\n`;
}

export function swiftForEmojiAliases(): string {
  const aliases = new Map<string, string>();
  for (const entry of emojiList) {
    if (typeof entry.emoji !== "string" || !Array.isArray(entry.aliases)) {
      throw new Error("Unknown web emoji entry shape");
    }
    for (const alias of entry.aliases) {
      if (typeof alias !== "string")
        throw new Error("Unknown emoji alias shape");
      if (!aliases.has(alias)) aliases.set(alias, entry.emoji);
    }
  }
  return `// Generated from the web emoji list by apps/ios/codegen/social.ts.\n\nenum WebEmojiAliases {\n  static let values: [String: String] = [\n${[...aliases].map(([alias, emoji]) => `    ${swiftString(alias)}: ${swiftString(emoji)},`).join("\n")}\n  ]\n}\n`;
}

export const SOCIAL_STYLE_PATH = new URL(
  "../Sources/TextKitEditor/WebSocialStyle.swift",
  import.meta.url,
);
export async function swiftForSocialStyle(): Promise<string> {
  const source = await Bun.file(
    new URL(
      "../../../packages/lexical-nodes/src/nodes/MentionNode.ts",
      import.meta.url,
    ),
  ).text();
  const styles = [...source.matchAll(/const mentionStyle = "([^"]+)";/g)];
  if (
    styles.length !== 1 ||
    !styles[0]?.[1] ||
    !source.includes("dom.style.cssText = mentionStyle;")
  )
    throw new Error("Unknown mention DOM style shape");
  const theme = await Bun.file(new URL("../../lexidraw/src/app/documents/[documentId]/themes/theme.ts", import.meta.url)).text();
  const mark = /mark:\s*"([^"]+)"/.exec(theme)?.[1] ?? "";
  const borderWidth = /(?:^| )border-b-(\d+)(?: |$)/.exec(mark)?.[1];
  if (!borderWidth || !mark.includes("bg-comment-mark") || !mark.includes("data-[comment=active]:bg-comment-mark-active")
    || !mark.includes("data-[comment=resolved]:bg-transparent") || !mark.includes("data-[comment=resolved]:border-transparent"))
    throw new Error("Unknown effective comment mark theme shape");
  const globals = await Bun.file(new URL("../../lexidraw/src/styles/globals.css", import.meta.url)).text();
  const colors = new ThemeColors(postcss.parse(globals));
  for (const name of ["comment-mark", "comment-border", "comment-mark-active"]) colors.name(`var(--${name})`);
  const entities = await entityTextStyles(theme, colors);
  const generatedColors = colors.used.map(([name, light, dark]) =>
    `  static let ${name} = ThemeColor(light: ${swiftRGBA(light)}, dark: ${swiftRGBA(dark)})`).join("\n");
  return `// Generated from web MentionNode.createDOM and the comment, hashtag and keyword theme by apps/ios/codegen/social.ts.\n\nenum WebSocialStyle {\n  static let mentionCSS = ${swiftString(styles[0][1])}\n${generatedColors}\n  static let commentBorderWidth: Double = ${Number(borderWidth)}\n  static let entityText: [String: EntityTextStyle] = [\n${entities.map(([type, color, weight]) => `    ${swiftString(type)}: EntityTextStyle(color: WebSocialStyle${color}, weight: ${weight ?? "nil"}),`).join("\n")}\n  ]\n}\n`;
}

const FONT_WEIGHTS: Record<string, number> = { "font-medium": 500, "font-semibold": 600, "font-bold": 700 };

/**
 * The colour and weight the document theme gives the text entities whose
 * createDOM reads a theme key: HashtagNode's `theme.hashtag` upstream, and
 * KeywordNode's `theme.keyword`.
 */
async function entityTextStyles(theme: string, colors: ThemeColors): Promise<[string, string, number | null][]> {
  const hashtag = await Bun.file(Bun.resolveSync("@lexical/hashtag", import.meta.dir).replace(/LexicalHashtag\.js$/, "LexicalHashtag.dev.js")).text();
  const keyword = await Bun.file(new URL("../../../packages/lexical-nodes/src/nodes/KeywordNode.ts", import.meta.url)).text();
  if (!hashtag.includes("addClassNamesToElement(element, config.theme.hashtag)")
    || !keyword.includes('addClassNamesToElement(dom, "keyword", config.theme.keyword)'))
    throw new Error("Unknown hashtag or keyword theme class shape");
  return ["hashtag", "keyword"].map((type) => {
    const classes = new RegExp(`^  ${type}: "([^"]+)",$`, "m").exec(theme)?.[1]?.split(" ") ?? [];
    let color: string | undefined;
    let weight: number | null = null;
    for (const name of classes) {
      if (name in FONT_WEIGHTS) weight = FONT_WEIGHTS[name] ?? null;
      else if (name.startsWith("text-") && colors.has(`--${name.slice(5)}`)) color = colors.name(`var(--${name.slice(5)})`);
      else throw new Error(`Unknown ${type} theme class ${name}`);
    }
    if (!color) throw new Error(`The theme gives ${type} no colour`);
    return [type, color, weight];
  });
}

export const FOOTNOTE_STYLE_PATH = new URL("../Sources/TextKitEditor/WebFootnoteStyle.swift", import.meta.url);
export async function swiftForFootnoteStyle(): Promise<string> {
  const css = await Bun.file(new URL("../../lexidraw/src/styles/document.css", import.meta.url)).text();
  const block = /\.document-content > \.footnote \{([^}]+)\}/.exec(css)?.[1] ?? "";
  const section = /\.document-content > :not\(\.footnote\) \+ \.footnote \{([^}]+)\}/.exec(css)?.[1] ?? "";
  const header = /\.document-content > :not\(\.footnote\) \+ \.footnote::before \{([^}]+)\}/.exec(css)?.[1] ?? "";
  const reference = /\.document-content sup\.footnote-ref \{([^}]+)\}/.exec(css)?.[1] ?? "";
  const values = {
    sectionMargin: /margin-block-start:\s*([\d.]+)em/.exec(section)?.[1],
    sectionPadding: /padding-block-start:\s*([\d.]+)em/.exec(section)?.[1],
    sectionBorder: /border-block-start:\s*([\d.]+)px/.exec(section)?.[1],
    headerWeight: /font-weight:\s*(\d+)/.exec(header)?.[1],
    headerTop: /inset-block-start:\s*([\d.]+)em/.exec(header)?.[1],
    headerFontScale: /font-size:\s*([\d.]+)rem/.exec(header)?.[1],
    definitionAfter: /margin-block:\s*0\s+([\d.]+)em/.exec(block)?.[1],
    followingMargin: /\.document-content > \.footnote \+ :not\(\.footnote\) \{[^}]*margin-block-start:\s*([\d.]+)em/.exec(css)?.[1],
    definitionFontScale: /font-size:\s*([\d.]+)em/.exec(block)?.[1],
    definitionLineHeight: /line-height:\s*([\d.]+)/.exec(block)?.[1],
    definitionIndent: /padding-inline-start:\s*([\d.]+)em/.exec(block)?.[1],
    referenceFontScale: /font-size:\s*([\d.]+)em/.exec(reference)?.[1],
    referenceWeight: /\.footnote-ref-link \{[^}]*font-weight:\s*(\d+)/.exec(css)?.[1],
    backrefMargin: /\.footnote-backref \{[^}]*margin-inline-start:\s*([\d.]+)em/.exec(css)?.[1],
  };
  const heading = /content:\s*"([^"]+)"/.exec(header)?.[1];
  const titles = new Map<string, string>([["", heading ?? ""]]);
  for (const match of css.matchAll(/\.document-content:lang\(([^)]+)\) > :not\(\.footnote\) \+ \.footnote::before \{\s*content:\s*"([^"]+)";/g)) {
    if (match[1] && match[2]) titles.set(match[1], match[2]);
  }
  if (!heading || Object.values(values).some(value => value === undefined)) throw new Error("Unknown footnote CSS shape");
  return `// Generated from document.css by apps/ios/codegen/social.ts.\n\nenum WebFootnoteStyle {\n${Object.entries(values).map(([key,value])=>`  static let ${key}: Double = ${value}`).join("\n")}\n  static let titles: [String: String] = [${[...titles].map(([key, value]) => `${swiftString(key)}: ${swiftString(value)}`).join(", ")}]\n}\n`;
}

export const COMMENT_DATA_PATH = new URL("../Sources/TextKitEditor/WebCommentData.swift", import.meta.url);
export async function swiftForCommentData(): Promise<string> {
  const plugin = await Bun.file(new URL("../../lexidraw/src/app/documents/[documentId]/plugins/CommentPlugin/index.tsx", import.meta.url)).text();
  const limit = /quote\.length\s*>\s*(\d+)/.exec(plugin)?.[1];
  const truncation = /\$\{quote\.slice\(0,\s*(\d+)\)\}([^`]*)/.exec(plugin);
  if (!limit || !truncation?.[1] || truncation[2] === undefined || Number(truncation[1]) >= Number(limit))
    throw new Error("Unknown comment quote truncation shape");
  const comment = CommentStore.createComment("", "", "", 0);
  const thread = CommentStore.createThread("", [], "");
  let commentJSON = "", threadJSON = "";
  const editor = createHeadlessEditor({ nodes: [CommentNode, ThreadNode], onError(error) { throw error; } });
  editor.update(() => {
    commentJSON = JSON.stringify(new CommentNode(comment).exportJSON());
    threadJSON = JSON.stringify(new ThreadNode(thread).exportJSON());
  }, { discrete: true });
  return `// Generated from web CommentStore and marker constructors by apps/ios/codegen/social.ts.\n\nenum WebCommentData {\n  static let quoteLimit = ${Number(limit)}\n  static let quotePrefix = ${Number(truncation[1])}\n  static let quoteEllipsis = ${swiftString(truncation[2])}\n  static let emptyCommentJSON = ${swiftString(JSON.stringify(comment))}\n  static let emptyCommentNodeJSON = ${swiftString(commentJSON)}\n  static let emptyThreadNodeJSON = ${swiftString(threadJSON)}\n}\n`;
}

export const ARTICLE_DATA_PATH = new URL("../Sources/LexidrawKit/WebArticleData.swift", import.meta.url);
export async function swiftForArticleData(): Promise<string> {
  const source = await Bun.file(new URL("../../lexidraw/src/app/documents/[documentId]/nodes/ArticleNode/ArticleBlock.tsx", import.meta.url)).text();
  const route = source.match(/href=\{`([^$`]+)\$\{data\.entityId\}/)?.[1];
  if (!route) throw new Error("Unknown article route shape");
  let json = "";
  const editor = createHeadlessEditor({ nodes: [ArticleNode], onError(error) { throw error; } });
  editor.update(() => { json = JSON.stringify(new ArticleNode().exportJSON()); }, { discrete: true });
  return `// Generated from the web ArticleNode constructor.\npublic enum WebArticleData {\n  public static let routePrefix = ${swiftString(route)}\n  public static let insertionNodeJSON = ${swiftString(json)}\n}\n`;
}

export const ARTICLE_TEXT_PATH = new URL("../Sources/LexicalSwift/WebArticlePlainText.swift", import.meta.url);
export async function swiftForArticlePlainText(): Promise<string> {
  const source = await Bun.file(new URL("../../../packages/lexical-nodes/src/html-to-text.ts", import.meta.url)).text();
  const matches = [...source.matchAll(/\.replace\((\/(?:[^\/\n]|\\.)+\/[a-z]*),\s*("(?:[^"\\]|\\.)*")\)/g)];
  if (matches.length !== 7 || !source.includes(".trim()")) throw new Error("Unknown article plain-text converter shape");
  const rules = matches.map(([, expression, replacement]) => {
    const regex = Function(`return (${expression})`)() as RegExp;
    return `    (JSRegExp(${swiftString(regex.source)}, flags: ${swiftString(regex.flags)}), ${swiftString(JSON.parse(replacement!))}),`;
  });
  return `// Generated from the web htmlToPlainText converter.\nimport EditorModelInterface\n\nenum WebArticlePlainText {\n  static let rules: [(JSRegExp, String)] = [\n${rules.join("\n")}\n  ]\n  static func convert(_ html: String) -> String {\n    JSRegExp("^\\\\s+|\\\\s+$", flags: "g").replacingMatches(in: rules.reduce(html) { $1.0.replacingMatches(in: $0, with: $1.1) }, with: "")\n  }\n}\n`;
}
