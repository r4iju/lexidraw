import { z } from "zod";

/**
 * A link entity's `elements`. Owners can store anything there, so each field
 * that doesn't fit falls back to absent instead of failing the page.
 */
const LinkElements = z
  .object({
    url: z.string().catch(""),
    distilled: z
      .object({
        title: z.string().optional().catch(undefined),
        byline: z.string().nullish().catch(undefined),
        siteName: z.string().nullish().catch(undefined),
        wordCount: z.number().nullish().catch(undefined),
        updatedAt: z.iso.datetime().optional().catch(undefined),
        contentHtml: z.string().optional().catch(undefined),
      })
      .optional()
      .catch(undefined),
  })
  .catch({ url: "", distilled: undefined });

export function parseLinkElements(elements: string | null | undefined) {
  let json: unknown;
  try {
    json = JSON.parse(elements || "{}");
  } catch {
    json = undefined;
  }
  return LinkElements.parse(json);
}
