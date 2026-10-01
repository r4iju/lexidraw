import { createHeadlessEditor } from "@lexical/headless";
import { $createTextNode } from "lexical";
import { parse } from "@babel/parser";
import emojis from "@packages/lexical-nodes/emoji-list";
import {
  EMOJI_TRIGGER,
  EMOJI_MIN_LENGTH,
  EMOJI_LIMIT,
  emojiOptions,
} from "../../lexidraw/src/app/documents/[documentId]/plugins/EmojiPickerPlugin/options";
import { swiftString } from "./swift";
export const EMOJI_PICKER_PATH = new URL(
  "../Sources/LexidrawJSON/WebEmojiPicker.swift",
  import.meta.url,
);
export async function swiftForEmojiPicker() {
  const source = await Bun.file(
    new URL(
      "../../lexidraw/node_modules/@lexical/react/src/LexicalTypeaheadMenuPluginUtils.ts",
      import.meta.url,
    ),
  ).text();
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const declarations = ast.program.body
    .filter((n) => n.type === "ExportNamedDeclaration")
    .map((n) => n.declaration)
    .filter(
      (n) =>
        n &&
        ((n.type === "FunctionDeclaration" &&
          n.id?.name === "useBasicTypeaheadTriggerMatch") ||
          (n.type === "VariableDeclaration" &&
            n.declarations.some(
              (d) => d.id.type === "Identifier" && d.id.name === "PUNCTUATION",
            ))),
    );
  if (declarations.length !== 2)
    throw new Error("Upstream trigger matcher changed");
  const code = declarations
    .map((n) => source.slice(n!.start!, n!.end!))
    .join("\n");
  let pattern = "";
  class ObservedRegExp extends RegExp {
    constructor(source: string, flags?: string) {
      super(source, flags);
      pattern = this.source;
    }
  }
  const matcher = new Function(
    "useCallback",
    "RegExp",
    new Bun.Transpiler({ loader: "ts" }).transformSync(code) +
      ";return useBasicTypeaheadTriggerMatch;",
  )((fn: unknown) => fn, ObservedRegExp)(EMOJI_TRIGGER, {
    minLength: EMOJI_MIN_LENGTH,
  });
  const probe = matcher(":smile");
  if (
    probe?.matchingString !== "smile" ||
    probe.replaceableString !== ":smile" ||
    probe.leadOffset !== 0 ||
    !pattern
  )
    throw new Error("Upstream trigger result changed");
  const main = await Bun.file(
    new URL(
      "../../lexidraw/src/app/documents/[documentId]/document-editor.tsx",
      import.meta.url,
    ),
  ).text();
  const mounts = [
    ...new Set(
      [...main.matchAll(/<(EmojiPickerPlugin|MentionsPlugin)\b/g)].map(
        (m) => m[1]!,
      ),
    ),
  ];
  if (!mounts.includes("EmojiPickerPlugin"))
    throw new Error("Main emoji mount changed");
  let textNode = "";
  createHeadlessEditor({
    onError(error) {
      throw error;
    },
  }).update(
    () => {
      textNode = JSON.stringify($createTextNode("").exportJSON());
    },
    { discrete: true },
  );
  return `// Generated from the mounted web picker, its emoji list, and the upstream trigger hook.\npublic enum WebEmojiPicker {\n  public static let textNodeJSON = ${swiftString(textNode)}\n  public static let pattern = ${swiftString(pattern)}\n  public static let limit = ${EMOJI_LIMIT}\n  public static let mainPlugins: Set<String> = [${mounts.map(swiftString).join(", ")}]\n  public struct Entry: Sendable { public let title: String; public let emoji: String; public let keywords: [String] }\n  public static let entries: [Entry] = [\n${emojiOptions(
    emojis,
  )
    .map(
      (e) =>
        `    Entry(title: ${swiftString(e.title)}, emoji: ${swiftString(e.emoji)}, keywords: [${e.keywords.map(swiftString).join(", ")}]),`,
    )
    .join("\n")}\n  ]\n}\n`;
}
