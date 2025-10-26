import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { extractAndSanitizeArticle } from "~/server/extractors/article";
import { eq, schema } from "@packages/drizzle";

export const articlesRouter = createTRPCRouter({
  extractFromUrl: protectedProcedure
    .input(
      z.object({
        url: z.url(),
        // optional client overrides; currently not used to change HTML
        maxChars: z.number().int().min(200).max(200000).optional(),
        keepQuotes: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Load per-user defaults (if any) to record intent; extractor returns HTML
      const user = await ctx.drizzle.query.users.findFirst({
        where: eq(schema.users.id, ctx.session.user.id),
        columns: { config: true },
      });
      const articleCfg = user?.config?.articles ?? {};
      const _maxChars = input.maxChars ?? articleCfg.maxChars;
      const _keepQuotes = input.keepQuotes ?? articleCfg.keepQuotes;

      const distilled = await extractAndSanitizeArticle({ url: input.url });

      return {
        title: distilled.title,
        byline: distilled.byline ?? null,
        siteName: distilled.siteName ?? null,
        wordCount: distilled.wordCount ?? null,
        excerpt: distilled.excerpt ?? null,
        contentHtml: distilled.contentHtml,
        bestImageUrl: distilled.bestImageUrl ?? null,
        datePublished: distilled.datePublished ?? null,
        updatedAt: distilled.updatedAt,
        // Echo back the effective options to help UIs debug
        __options: {
          maxChars: _maxChars,
          keepQuotes: _keepQuotes,
        },
      } as const;
    }),
});

export type ArticlesRouter = typeof articlesRouter;
