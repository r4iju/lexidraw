import { z } from "zod";

// Minimal shared shapes (no React/editor deps)
export const EditorKeySchema = z.string().optional();
export const InsertionRelationSchema = z.enum([
  "before",
  "after",
  "appendRoot",
]);
export const InsertionAnchorSchema = z
  .union([
    z.object({ type: z.literal("key"), key: z.string() }),
    z.object({ type: z.literal("text"), text: z.string() }),
  ])
  .describe("Anchor for insertion point, either by node key or nearby text");
