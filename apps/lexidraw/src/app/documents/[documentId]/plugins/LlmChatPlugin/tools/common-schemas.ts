import { z } from "zod";

export const EditorKeySchema = z
  .string()
  .describe(
    "Key to target a nested editor, e.g., 'deckNodeKey/slideId/boxId'. Defaults to the main editor.",
  );

export const InsertionRelationSchema = z
  .enum(["before", "after", "appendRoot"])
  .default("appendRoot");
export type InsertionRelation = z.infer<typeof InsertionRelationSchema>;

export const InsertionAnchorSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z
        .literal("key")
        .describe('type can be "key" or "text", never heading'),
      key: z.string(),
    }),
    z.object({
      type: z
        .literal("text")
        .describe('type can be "key" or "text", never heading'),
      text: z.string(),
    }),
  ])
  .describe(
    "Anchor for insertion tools. Key is the key of the target node's key. Text is the text content of the target node.",
  );
export type InsertionAnchor = z.infer<typeof InsertionAnchorSchema>;

export type InsertionPointResolution =
  | { status: "success"; type: "appendRoot" }
  | {
      status: "success";
      type: "before" | "after";
      targetKey: string;
      // We return the key to avoid passing live node references outside the update cycle
    }
  | { status: "error"; message: string };
