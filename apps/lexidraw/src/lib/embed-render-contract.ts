import { z } from "zod";
import { CHART_TYPES } from "@packages/lexical-nodes";

const dimension = z
  .union([z.literal("inherit"), z.number().positive().max(16384)])
  .optional();
const figureState = z
  .object({
    figure: z
      .object({
        caption: z.string().max(10000).optional(),
        width: z.string().max(20).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .optional();
const source = z.string().max(262144);
const child = z
  .object({
    type: z.enum(["text", "code-highlight", "tab", "linebreak"]),
    text: z.string().optional(),
  })
  .passthrough();
const articleSnapshot = z
  .object({ title: z.string(), contentHtml: source })
  .passthrough();
const articleData = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("url"),
      url: z.string(),
      distilled: articleSnapshot,
    })
    .passthrough(),
  z
    .object({
      mode: z.literal("entity"),
      entityId: z.string(),
      snapshot: articleSnapshot.optional(),
    })
    .passthrough(),
]);
export const embeddedNode = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("article"),
      data: articleData,
      format: z
        .enum(["", "left", "center", "right", "justify", "start", "end"])
        .optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("mermaid"),
      schema: source,
      $: figureState,
      width: dimension,
      height: dimension,
    })
    .passthrough(),
  z
    .object({
      type: z.literal("equation"),
      equation: source,
      inline: z.boolean().default(false),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("chart"),
      chartType: z.enum(CHART_TYPES),
      chartData: source,
      chartConfig: source,
      $: figureState,
      width: dimension,
      height: dimension,
    })
    .passthrough(),
  z
    .object({
      type: z.literal("code"),
      children: z.array(child).max(10000),
      language: z.string().max(80).nullable().optional(),
      showLineNumbers: z.boolean().optional(),
    })
    .passthrough(),
]);
export const embedRenderRequest = z.object({
  node: embeddedNode,
  theme: z.enum(["light", "dark"]),
  width: z.number().int().min(1).max(2048),
  // Native sends the document's fully expanded CSS font stack, about 300
  // characters for CJK documents, plus a custom font name in front.
  fontFamily: z.string().min(1).max(1024),
  fontSize: z.number().min(1).max(256),
  includeAccessibility: z.boolean().optional(),
  articleImagesVersion: z.enum(["v1"]).optional(),
});
export const embedRenderImage = z.object({
  articleImageBasePNG: z.string().max(12000000).optional(),
  articleImages: z
    .array(
      z.object({
        source: z.string().max(8192),
        url: z.string().max(8192).optional(),
        heading: z.boolean().optional(),
        alt: z.string().max(262144),
        textIndex: z.number().int().min(0).max(4096),
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        objectFit: z.string().max(64),
        overlay: z.boolean(),
        refusal: z.string().max(1024).optional(),
      }),
    )
    .max(64)
    .optional(),
  accessibility: z
    .array(
      z.object({
        role: z.enum(["heading", "text", "link"]),
        heading: z.boolean().optional(),
        text: z.string().max(262144),
        url: z.string().max(8192).optional(),
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    )
    .max(4096)
    .optional(),
  accessibleText: z.string().max(262144).optional(),
  links: z
    .array(
      z.object({
        url: z.string().max(8192),
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    )
    .optional(),
  svg: z.string().max(8000000),
  png: z.string().max(12000000),
  width: z.number().positive().max(16384),
  height: z.number().positive().max(16384),
});
export type EmbeddedNode = z.infer<typeof embeddedNode>;
export type EmbedRequest = z.infer<typeof embedRenderRequest>;
