import { z } from "zod";
import { tool } from "ai";
import { api } from "~/trpc/react";

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
      url: z.string().url().describe("URL to extract."),
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
