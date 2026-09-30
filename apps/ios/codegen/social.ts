import { createHeadlessEditor } from "@lexical/headless";
import emojiList from "../../../packages/lexical-nodes/src/emoji-list";
import { PollNode } from "@packages/lexical-nodes";
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
  return `// Generated from web MentionNode.createDOM by apps/ios/codegen/social.ts.\n\nenum WebSocialStyle {\n  static let mentionCSS = ${swiftString(styles[0][1])}\n}\n`;
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
