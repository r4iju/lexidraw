import { z } from "zod";
import { makeRuntimeSpec } from "./reflect-editor-runtime";
import { LexicalEditor } from "lexical";

export function buildDynamicEnums(editor: LexicalEditor) {
  const spec = makeRuntimeSpec(editor);

  // Block vs inline
  const blockTypes = spec.nodes
    .filter((n) => !n.isInline && !n.isDecorator)
    .map((n) => n.type) as [string, ...string[]];

  const inlineTypes = spec.nodes
    .filter((n) => n.isInline)
    .map((n) => n.type) as [string, ...string[]];

  return {
    BlockTypeE: z.enum(blockTypes),
    InlineTypeE: z.enum(inlineTypes),
    NodeSpecByType: Object.fromEntries(spec.nodes.map((n) => [n.type, n])),
  };
}
