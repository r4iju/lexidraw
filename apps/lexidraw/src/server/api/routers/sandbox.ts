import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import env from "@packages/env";
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
  search: sandboxOnly.input(GoogleSearchInput).query(async ({ input }) => {
    const apiKey = env.GOOGLE_API_KEY;
    const cx = env.GOOGLE_SEARCH_ENGINE_ID;
    if (!apiKey || !cx) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Missing Google search configuration",
      });
    }
    const q = input.site ? `site:${input.site} ${input.query}` : input.query;
    const params = new URLSearchParams({
      key: apiKey,
      cx,
      q,
      num: String(Math.max(1, Math.min(10, input.num ?? 5))),
      safe: input.safe ?? "off",
      fields:
        "items(title,link,snippet,htmlSnippet,displayLink),searchInformation(totalResults)",
      prettyPrint: "false",
    });
    const url = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      let reason = "";
      try {
        const asJson = (await res.json()) as {
          error?: { code?: number; status?: string; message?: string };
        };
        reason = asJson?.error?.message || asJson?.error?.status || "";
      } catch {
        const body = await res.text();
        reason = body?.slice(0, 300);
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Google CSE error: ${res.status}${reason ? ` - ${reason}` : ""}`,
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
    const items: GoogleCseItem[] = Array.isArray(data.items) ? data.items : [];
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



