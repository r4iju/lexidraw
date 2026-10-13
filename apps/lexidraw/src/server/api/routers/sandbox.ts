import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { sandboxAuthMiddleware } from "~/server/api/sandbox-auth";

const sandboxOnly = publicProcedure.use(async ({ ctx, next }) => {
  // Verify x-sandbox-auth-jwt header
  try {
    await sandboxAuthMiddleware()({ ctx, next: async () => {} });
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next();
});

const GoogleSearchInput = z.object({
  query: z.string().min(1),
  num: z.number().int().min(1).max(10).optional().default(5),
  site: z.string().min(1).optional(),
  safe: z.enum(["active", "off"]).optional().default("off"),
});

export const sandboxRouter = createTRPCRouter({
  search: sandboxOnly.input(GoogleSearchInput).query(
    async (): Promise<{
      results: {
        title: string;
        url: string;
        snippet: string;
        source?: string;
      }[];
      total?: number;
    }> => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Paid search requires a server-authorized parent action budget. Direct and sandbox search are unavailable.",
      });
    },
  ),

  fetchArticle: sandboxOnly
    .input(
      z.object({
        url: z.string().url(),
        maxChars: z.number().int().min(200).max(20000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { extractAndSanitizeArticle } = await import(
        "~/server/extractors/article"
      );
      try {
        const distilled = await extractAndSanitizeArticle({ url: input.url });
        const text = stripHtmlToText(distilled.contentHtml);
        const content =
          typeof input.maxChars === "number"
            ? text.slice(0, input.maxChars)
            : text;
        return {
          url: input.url,
          title: distilled.title,
          content,
          length: content.length,
          excerpt: distilled.excerpt ?? undefined,
        };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Failed to extract article",
        });
      }
    }),
});

function stripHtmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>(?=\s*\n?)/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\t\u00A0]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
