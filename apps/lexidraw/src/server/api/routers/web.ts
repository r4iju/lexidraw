import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import env from "@packages/env";

const GoogleSearchInput = z.object({
  query: z.string().min(1),
  num: z.number().int().min(1).max(10).optional().default(5),
  site: z.string().min(1).optional(),
  safe: z.enum(["active", "off"]).optional().default("off"),
});

export const webRouter = createTRPCRouter({
  googleSearch: protectedProcedure
    .input(GoogleSearchInput)
    .query(async ({ ctx, input }) => {
      const userGoogleKey = ctx.session.user.config?.llm?.googleApiKey as
        | string
        | undefined;
      const apiKey = userGoogleKey || env.GOOGLE_API_KEY;
      const cx = env.GOOGLE_SEARCH_ENGINE_ID;

      if (!apiKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Missing Google API key.",
        });
      }
      if (!cx) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Missing GOOGLE_SEARCH_ENGINE_ID.",
        });
      }

      const q = input.site ? `site:${input.site} ${input.query}` : input.query;
      const params = new URLSearchParams({
        key: apiKey,
        cx,
        q,
        num: String(Math.max(1, Math.min(10, input.num ?? 5))),
        safe: input.safe ?? "off",
      });

      const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        // 6s cap to avoid long agent stalls
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Google CSE error: ${res.status}`,
          cause: body,
        });
      }
      type GoogleCseItem = {
        title?: string;
        link?: string;
        snippet?: string;
        htmlSnippet?: string;
        displayLink?: string;
      };
      type GoogleCseResponse = {
        items?: GoogleCseItem[];
        searchInformation?: { totalResults?: string };
      };
      const data = (await res.json()) as GoogleCseResponse;
      const items: GoogleCseItem[] = Array.isArray(data.items)
        ? data.items
        : [];
      return {
        results: items.map((it: GoogleCseItem) => ({
          title: String(it.title ?? ""),
          url: String(it.link ?? ""),
          snippet: String(it.snippet ?? it.htmlSnippet ?? ""),
          source: it.displayLink ? String(it.displayLink) : undefined,
        })),
        total: data.searchInformation?.totalResults
          ? Number(data.searchInformation.totalResults)
          : undefined,
      };
    }),

  extractWebpageContent: protectedProcedure
    .input(
      z.object({
        url: z.string().url(),
        maxChars: z.number().int().min(200).max(20000).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Prefer the robust extractor already present in the codebase
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

export type WebRouter = typeof webRouter;

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
