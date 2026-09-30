import { createHeadlessEditor } from "@lexical/headless";
import { $create } from "lexical";
import { CHART_TYPES, ChartNode, DocumentCodeNode, EquationNode, MermaidNode } from "@packages/lexical-nodes";
import { documentFont } from "../../lexidraw/src/lib/document-fonts";
import { swiftRawString } from "./links";

export const RENDERED_EMBED_STYLE_PATH = new URL("../Sources/LexidrawJSON/RenderedEmbedStyle.swift", import.meta.url);
export async function swiftForRenderedEmbedStyle(): Promise<string> {
  const defaults: [string, string][] = [];
  const editor = createHeadlessEditor({ nodes: [MermaidNode, EquationNode, ChartNode, DocumentCodeNode], onError: (error) => { throw error; } });
  editor.update(() => {
    for (const node of [$create(MermaidNode), $create(EquationNode), $create(ChartNode), $create(DocumentCodeNode)]) defaults.push([node.getType(), JSON.stringify(node.exportJSON())]);
  }, { discrete: true });
  const figure = await Bun.file(new URL("../../lexidraw/src/app/documents/[documentId]/nodes/common/figure-box.tsx", import.meta.url)).text();
  const scale = /minWidth: natural && natural\.width \* ([\d.]+)/.exec(figure)?.[1];
  if (!scale) throw new Error("Unknown web diagram minimum width");
  return `// Generated from web node constructors, documentFont and diagramStyle.\n// Run bun run codegen in apps/ios to update.\npublic enum RenderedEmbedStyle {\n  public static let defaultFontFamily = ${swiftRawString(documentFont().family)}\n  public static let diagramMinimumScale = ${scale}\n  public static let chartTypes = [${CHART_TYPES.map(swiftRawString).join(", ")}]\n  public static let insertionNodeJSON: [String: String] = [\n${defaults.map(([type, json]) => `    ${swiftRawString(type)}: ${swiftRawString(json)},`).join("\n")}\n  ]\n}\n`;
}
