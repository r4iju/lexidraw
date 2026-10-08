import { parse } from "@babel/parser";
import { swiftString } from "./swift";
import { createHeadlessEditor } from "@lexical/headless";
import { $createHashtagNode, HashtagNode } from "@lexical/hashtag";
import {
  $createKeywordNode,
  KeywordNode,
  EmojiNode,
} from "@packages/lexical-nodes";

export const TEXT_ENTITIES_PATH = new URL(
  "../Sources/LexicalSwift/WebTextEntities.swift",
  import.meta.url,
);
const pluginBase = new URL(
  "../../lexidraw/src/app/documents/[documentId]/plugins/",
  import.meta.url,
);

export async function webEntityPatterns() {
  const hashtagSource = await Bun.file(
    new URL(
      "../../lexidraw/node_modules/@lexical/hashtag/src/LexicalHashtagExtension.ts",
      import.meta.url,
    ),
  ).text();
  const hashtagAst = parse(hashtagSource, {
    sourceType: "module",
    plugins: ["typescript"],
  });
  const names = [
    "getHashtagRegexStringChars",
    "getHashtagRegexString",
    "createHashtagRegExp",
  ];
  const functions = hashtagAst.program.body.filter(
    (node) =>
      node.type === "FunctionDeclaration" &&
      names.includes(node.id?.name ?? ""),
  );
  if (
    functions.length !== names.length ||
    !hashtagSource.includes("const hashtagLength = matchArr[3].length + 1;") ||
    !hashtagSource.includes("matchArr.index + matchArr[1].length")
  )
    throw new Error("Unknown upstream hashtag match shape");
  const code = functions
    .map((node) => hashtagSource.slice(node.start!, node.end!))
    .join("\n");
  const hashtag: RegExp = new Function(
    new Bun.Transpiler({ loader: "ts" }).transformSync(code) +
      "; return createHashtagRegExp();",
  )();
  const keywordSource = await Bun.file(
    new URL("KeywordsPlugin/index.ts", pluginBase),
  ).text();
  const keywordAst = parse(keywordSource, {
    sourceType: "module",
    plugins: ["typescript"],
  });
  const declarations = keywordAst.program.body.flatMap((node) =>
    node.type === "VariableDeclaration" ? node.declarations : [],
  );
  const keyword = declarations.find(
    (node) =>
      node.id.type === "Identifier" && node.id.name === "KEYWORDS_REGEX",
  )?.init;
  if (
    keyword?.type !== "RegExpLiteral" ||
    !keywordSource.includes("(matchArr[2] as string).length") ||
    !keywordSource.includes("matchArr.index + (matchArr[1] as string).length")
  )
    throw new Error("Unknown keyword match shape");
  const emojiSource = await Bun.file(
    new URL("EmojisPlugin/index.ts", pluginBase),
  ).text();
  const pairs = [
    ...emojiSource.matchAll(/\["([^"\\]*)", \["([^"\\]*)", "([^"\\]*)"\]\]/g),
  ].map((match) => [match[1]!, match[2]!, match[3]!]);
  if (
    pairs.length !== 4 ||
    !emojiSource.includes("text.slice(i, i + 2)") ||
    !emojiSource.includes("node.splitText(i, i + 2)")
  )
    throw new Error("Unknown emoji transform shape");
  return {
    hashtag,
    keyword: new RegExp(keyword.pattern, keyword.flags),
    pairs,
  };
}

export async function swiftForTextEntities(): Promise<string> {
  const { hashtag, keyword, pairs } = await webEntityPatterns();
  const defaults: Record<string, string> = {};
  const editor = createHeadlessEditor({
    nodes: [HashtagNode, KeywordNode, EmojiNode],
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      defaults.hashtag = JSON.stringify($createHashtagNode("").exportJSON());
      defaults.keyword = JSON.stringify($createKeywordNode("").exportJSON());
      defaults.emoji = JSON.stringify(
        EmojiNode.$createEmojiNode("", "").exportJSON(),
      );
    },
    { discrete: true },
  );
  return `// Generated from the mounted web hashtag, keyword and emoji plugin sources.\nimport EditorModelInterface\n\nenum WebTextEntities {\n  static let hashtag = JSRegExp(${swiftString(hashtag.source)}, flags: ${swiftString(hashtag.flags)})\n  static let keyword = JSRegExp(${swiftString(keyword.source)}, flags: ${swiftString(keyword.flags)})\n  static let defaults: [String: String] = [${Object.entries(
    defaults,
  )
    .map(([type, json]) => `${swiftString(type)}: ${swiftString(json)}`)
    .join(
      ", ",
    )}]\n  static let emojis: [(String, String, String)] = [\n${pairs.map((pair) => `    (${pair.map(swiftString).join(", ")}),`).join("\n")}\n  ]\n}\n`;
}
