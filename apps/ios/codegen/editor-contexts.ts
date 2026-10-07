import { parse } from "@babel/parser";
import type { Node } from "@babel/types";
import { createHeadlessEditor } from "@lexical/headless";
import { SCHEMA_NODES } from "@packages/lexical-nodes/nodes";
import { RootNode, TextNode, LineBreakNode, ParagraphNode } from "lexical";

function walk(node: Node, visit: (node: Node) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (child && typeof child.type === "string") walk(child, visit); }
    else if (value && typeof value === "object" && "type" in value && typeof value.type === "string") walk(value as Node, visit);
  }
}
import { swiftString } from "./swift";

export const CONTEXTS_PATH = new URL("../Sources/LexicalSwift/WebEditorContext.swift", import.meta.url);
const sources = {
  stickyCaption: ["StickyComponent.tsx", "LexicalNestedComposer"],
  imageCaption: ["ImageNode/ImageComponent.tsx", "ImageCaption"],
  inlineImageCaption: ["InlineImageNode/InlineImageComponent.tsx", "ImageCaption"],
  videoCaption: ["VideoNode/VideoComponent.tsx", "ImageCaption"],
} as const;
const knownPlugins = new Set("PlainTextPlugin MentionsPlugin LinkPlugin EmojisPlugin HashtagPlugin KeywordsPlugin HistoryPlugin TreeViewPlugin".split(" "));

export async function webEditorContexts(): Promise<Record<keyof typeof sources, string[]>> {
  const result = {} as Record<keyof typeof sources, string[]>;
  for (const [name, [path, wrapper]] of Object.entries(sources)) {
    const text = await Bun.file(new URL(`../../lexidraw/src/app/documents/[documentId]/nodes/${path}`, import.meta.url)).text();
    const ast = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] });
    const scopes: Node[] = [];
    walk(ast, node => {
      if (node.type === "JSXElement" && node.openingElement.name.type === "JSXIdentifier" && node.openingElement.name.name === wrapper) scopes.push(node);
    });
    if (scopes.length !== 1) throw new Error(`Unknown ${name} editor wrapper shape`);
    const plugins: string[] = [];
    const visit = (node: Node) => {
      if (node.type === "JSXOpeningElement") {
        if (node.name.type !== "JSXIdentifier") throw new Error(`Unknown mounted ${name} component shape`);
        const tag = node.name.name;
        if (tag.endsWith("Plugin")) {
          if (!knownPlugins.has(tag)) throw new Error(`Unknown mounted ${name} plugin ${tag}`);
          if (!plugins.includes(tag)) plugins.push(tag);
        }
      }
    };
    walk(scopes[0]!, visit);
    result[name as keyof typeof sources] = plugins;
  }
  return result;
}

export async function swiftForEditorContexts(): Promise<string> {
  const contexts = await webEditorContexts();
  const registries = await webEditorRegistries();
  return `// Generated from the actual nested editor JSX plugin mounts and node constructors.\n\npublic enum EditorContext: String, Codable, Sendable {\n  case document\n${Object.keys(contexts).map(name => `  case ${name}`).join("\n")}\n\n  var mountedPlugins: [String] {\n    switch self {\n    case .document: []\n${Object.entries(contexts).map(([name, plugins]) => `    case .${name}: Self.${name}Plugins`).join("\n")}\n    }\n  }\n\n  public var registeredTypes: Set<String>? {\n    switch self {\n    case .document: nil\n${Object.entries(registries).map(([name, types]) => `    case .${name}: ${types ? `Self.${name}Registry` : "nil"}`).join("\n")}\n    }\n  }\n\n${Object.entries(contexts).map(([name, plugins]) => `  private static let ${name}Plugins: [String] = [${plugins.map(swiftString).join(", ")}]`).join("\n")}\n\n${Object.entries(registries).filter(([, types]) => types !== null).map(([name, types]) => `  private static let ${name}Registry: Set<String> = [${types!.map(swiftString).join(", ")}]`).join("\n")}\n}\n`;
}

export async function webEditorRegistries(): Promise<Record<keyof typeof sources, string[] | null>> {
  const classes = new Map([...SCHEMA_NODES, RootNode, TextNode, LineBreakNode, ParagraphNode].map(node => [node.name, node]));
  const result = {} as Record<keyof typeof sources, string[] | null>;
  for (const [name, path] of Object.entries({ imageCaption: "ImageNode", inlineImageCaption: "InlineImageNode", videoCaption: "VideoNode" })) {
    const source = await Bun.file(new URL(`../../../packages/lexical-nodes/src/nodes/${path}.ts`, import.meta.url)).text();
    const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
    const factory = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "createCaptionEditor");
    if (!factory) throw new Error(`Unknown ${name} constructor`);
    const constructors: Node[] = [];
    walk(factory, node => { if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "createEditor") constructors.push(node); });
    if (constructors.length !== 1 || constructors[0]?.type !== "CallExpression") throw new Error(`Unknown ${name} editor construction shape`);
    const args = constructors[0].arguments;
    if (args.length === 0) { result[name as keyof typeof sources] = null; continue; }
    const config = args[0];
    if (args.length !== 1 || config?.type !== "ObjectExpression") throw new Error(`Unknown ${name} configuration`);
    const nodes = config.properties.find(property => property.type === "ObjectProperty" && property.key.type === "Identifier" && property.key.name === "nodes");
    if (nodes?.type !== "ObjectProperty" || nodes.value.type !== "ArrayExpression") throw new Error(`Unknown ${name} registered nodes`);
    const registered = nodes.value.elements.map(node => {
      if (node?.type !== "Identifier" || !classes.has(node.name)) throw new Error(`Unknown ${name} registered node`);
      return classes.get(node.name)!;
    });
    result[name as keyof typeof sources] = [...createHeadlessEditor({ nodes: registered })._nodes.keys()].sort();
  }
  const stickySource = await Bun.file(new URL("../../../packages/lexical-nodes/src/nodes/StickyNode.ts", import.meta.url)).text();
  const stickyAST = parse(stickySource, { sourceType: "module", plugins: ["typescript"] });
  const stickyConstructors: Node[] = [];
  walk(stickyAST, node => { if (node.type === "ClassMethod" && node.kind === "constructor") stickyConstructors.push(node); });
  if (stickyConstructors.length !== 1) throw new Error("Unknown sticky caption constructor");
  const stickyEditors: Node[] = [];
  walk(stickyConstructors[0]!, node => { if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "createEditor") stickyEditors.push(node); });
  if (stickyEditors.length !== 1 || stickyEditors[0]?.type !== "CallExpression" || stickyEditors[0].arguments.length !== 0) throw new Error("Unknown sticky caption editor configuration");
  result.stickyCaption = null;
  return result;
}
