import { z } from "zod";

const nonBlank = (field: string) =>
  z
    .string()
    .refine((value) => value.trim() !== "", `${field} must not be blank`);

/**
 * The markdown a write carries. Refined rather than trimmed: leading
 * indentation is markdown too.
 */
export const MarkdownBody = nonBlank("markdown");

/** Where an insert goes, when it goes after a heading rather than at an index. */
export const AfterHeading = nonBlank("afterHeading").describe(
  "Insert after the first root-level heading whose plain text matches (trimmed, whitespace collapsed, case-insensitive). Pass exactly one of afterHeading or atBlockIndex.",
);

export const CreateDocument = z.object({
  id: z.string(),
  title: z.string(),
  elements: z.any(),
});

export type CreateDocument = z.infer<typeof CreateDocument>;
