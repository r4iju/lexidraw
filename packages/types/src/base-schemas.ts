import { z } from "zod";

// Minimal shared shapes (no React/editor deps)
export const EditorKeySchema = z.string().optional();
export const InsertionRelationSchema = z.enum([
  "before",
  "after",
  "appendRoot",
]);
export const InsertionAnchorSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("key"), key: z.string() }),
    z.object({ type: z.literal("text"), text: z.string() }),
  ])
  .describe(
    "Anchor for insertion point. Must be an object with 'type' field: { type: 'key', key: string } to target by node key, or { type: 'text', text: string } to target by text content. Do not pass a string directly.",
  );
