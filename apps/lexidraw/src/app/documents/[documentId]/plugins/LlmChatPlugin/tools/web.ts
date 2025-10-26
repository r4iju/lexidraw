import { z } from "zod";
import { tool } from "ai";
import { api } from "~/trpc/react";

export const WEB_TOOL_LABELS: Record<string, string | undefined> = {
  googleSearch: "Google search",
  extractWebpageContent: "Extract web page",
} as const;

export const WEB_TOOL_FORMATTERS: Record<
  string,
  (args: Record<string, unknown>) => string | undefined
> = {
  googleSearch: (args) => {
    const query = typeof args.query === "string" ? args.query : undefined;
    const site = typeof args.site === "string" ? args.site : undefined;
    if (!query) return undefined;
    return site
      ? `Agent searched "${query}" on ${site}`
      : `Agent searched "${query}"`;
  },
  extractWebpageContent: (args) => {
    const url = typeof args.url === "string" ? args.url : undefined;
    if (!url) return undefined;
    try {
      const host = new URL(url).host;
      return `Agent extracted ${host}`;
    } catch {
      return `Agent extracted web page`;
    }
  },
};

export function useWebTools() {
  const utils = api.useUtils();
  const extractWebpageContentMutation =
    api.web.extractWebpageContent.useMutation();

  const googleSearch = tool({
    description:
      "Performs a Google Custom Search for the given query and returns top results.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Search query."),
      num: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Max results (<=10)."),
      site: z
        .string()
        .optional()
        .describe("Restrict to a specific site domain."),
      safe: z.enum(["active", "off"]).optional().describe("Safe search mode."),
    }),
    execute: async ({ query, num, site, safe }) => {
      const res = await utils.web.googleSearch.fetch({
        query,
        num,
        site,
        safe,
      });
      return {
        success: true,
        content: {
          summary: `Found ${res.results.length} results for: ${query}`,
          results: res.results,
          total: res.total,
        },
      } as const;
    },
  });

  const extractWebpageContent = tool({
    description:
      "Fetches a web page and extracts a readable text summary (server-side).",
    inputSchema: z.object({
      url: z.url().describe("URL to extract."),
      maxChars: z.number().int().min(200).max(20000).optional(),
    }),
    execute: async ({ url, maxChars }) => {
      const res = await extractWebpageContentMutation.mutateAsync({
        url,
        maxChars,
      });
      return {
        success: true,
        content: {
          summary: `Extracted ${res.length} chars from ${new URL(url).host}`,
          article: res,
        },
      } as const;
    },
  });

  return { googleSearch, extractWebpageContent };
}
