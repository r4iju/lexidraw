import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getUnsplash } from "~/server/unsplash";
import { TRPCError } from "@trpc/server";
import env from "@packages/env";
import { schema, eq } from "@packages/drizzle";

const TrackDownloadInput = z.object({
  downloadLocation: z.url(),
});

// Updated input schema for search to include pagination
const SearchUnsplashInput = z.object({
  query: z.string().min(1),
  page: z.number().int().min(1).optional().default(1),
  perPage: z.number().int().min(1).max(30).optional().default(10), // Max 30 per Unsplash guidelines
});

const GenerateAiImageInput = z.object({
  prompt: z.string().min(1),
  // Keep optional for future UI; policy defaults are used when omitted.
  provider: z.enum(["openai", "google"]).optional(),
  modelId: z.string().optional(),
  size: z.enum(["256x256", "512x512", "1024x1024"]).optional(),
});

export const imageRouter = createTRPCRouter({
  getAiGenerationStatus: protectedProcedure.query(async ({ ctx }) => {
    const [policy] = await ctx.drizzle
      .select({
        provider: schema.llmPolicies.provider,
        modelId: schema.llmPolicies.modelId,
      })
      .from(schema.llmPolicies)
      .where(eq(schema.llmPolicies.mode, "image"))
      .limit(1);

    const hasGoogle = !!env.GOOGLE_API_KEY;
    const hasOpenAi = !!env.OPENAI_API_KEY;

    return {
      hasPolicy: !!policy,
      policy: policy ?? null,
      hasGoogleApiKey: hasGoogle,
      hasOpenAiApiKey: hasOpenAi,
      isConfigured:
        !!policy &&
        ((policy?.provider === "google" && hasGoogle) ||
          (policy?.provider === "openai" && hasOpenAi)),
    };
  }),

  generateAiImage: protectedProcedure
    .input(GenerateAiImageInput)
    .mutation(async ({ ctx, input }) => {
      const [policy] = await ctx.drizzle
        .select({
          provider: schema.llmPolicies.provider,
          modelId: schema.llmPolicies.modelId,
          allowedModels: schema.llmPolicies.allowedModels,
        })
        .from(schema.llmPolicies)
        .where(eq(schema.llmPolicies.mode, "image"))
        .limit(1);

      if (!policy) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No LLM policy found for mode: image. Create it in Admin → LLM → Policies (Image).",
        });
      }

      const provider = (input.provider ?? policy.provider).toString();
      const modelId = (input.modelId ?? policy.modelId).toString();

      const allowed = Array.isArray(policy.allowedModels)
        ? policy.allowedModels
        : [];
      if (allowed.length > 0) {
        const ok = allowed.some(
          (m) => m.provider === provider && m.modelId === modelId,
        );
        if (!ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Model ${provider}:${modelId} is not allowed for image mode.`,
          });
        }
      }

      if (provider === "google") {
        const apiKey = env.GOOGLE_API_KEY;
        if (!apiKey) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Missing GOOGLE_API_KEY for Gemini image generation.",
          });
        }

        const url = new URL(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            modelId,
          )}:generateContent`,
        );
        url.searchParams.set("key", apiKey);

        const payload = {
          contents: [
            {
              role: "user",
              parts: [{ text: input.prompt }],
            },
          ],
          generationConfig: {
            // These values are best-effort; image preview models may ignore them.
            temperature: 0.2,
            responseModalities: ["IMAGE"],
          },
        } as const;

        const resp = await fetch(url.toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await resp.json().catch(() => ({}))) as unknown;
        if (!resp.ok) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: `Gemini image generation failed: ${resp.status} ${resp.statusText} ${JSON.stringify(json)}`,
          });
        }

        type GeminiInlineData = { mimeType?: string; data?: string };
        type GeminiPart = { inlineData?: GeminiInlineData; text?: string };
        type GeminiCandidate = { content?: { parts?: GeminiPart[] } };
        type GeminiResponse = { candidates?: GeminiCandidate[] };

        const data = (json as GeminiResponse).candidates
          ?.flatMap((c) => c.content?.parts ?? [])
          .map((p) => p.inlineData)
          .find((d) => d && typeof d.data === "string" && d.data.length > 0);

        if (!data?.data) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message:
              "Gemini response did not include image inlineData. Check model capabilities and request format.",
          });
        }

        return {
          provider,
          modelId,
          mimeType: data.mimeType || "image/png",
          imageBase64: data.data,
        };
      }

      if (provider === "openai") {
        const apiKey = env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Missing OPENAI_API_KEY for OpenAI image generation.",
          });
        }

        const resp = await fetch(
          "https://api.openai.com/v1/images/generations",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: modelId,
              prompt: input.prompt,
              size: input.size ?? "1024x1024",
              response_format: "b64_json",
            }),
          },
        );

        const json = (await resp.json().catch(() => ({}))) as unknown;
        if (!resp.ok) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: `OpenAI image generation failed: ${resp.status} ${resp.statusText} ${JSON.stringify(json)}`,
          });
        }

        const b64 = (json as { data?: Array<{ b64_json?: string }> }).data?.[0]
          ?.b64_json;
        if (typeof b64 !== "string" || !b64) {
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message: "OpenAI response missing b64_json image data.",
          });
        }

        return {
          provider,
          modelId,
          mimeType: "image/png",
          imageBase64: b64,
        };
      }

      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unsupported provider for image generation: ${provider}`,
      });
    }),

  imLuckyUnsplash: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      console.log(`I'm lucky search for: ${input.query}`);

      const unsplash = getUnsplash();
      if (!unsplash) {
        console.error(
          "Unsplash client is not initialized. Check server setup and UNSPLASH_ACCESS_KEY.",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Image search service is unavailable.",
        });
      }

      try {
        const result = await unsplash.search.getPhotos({
          query: input.query,
          page: 1,
          perPage: 1,
        });

        if (
          result.errors ||
          !result.response ||
          result.response.results.length === 0
        ) {
          console.error("Error fetching from Unsplash:", result.errors);
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No images found for "${input.query}" on Unsplash.`,
          });
        }

        const firstImage = result.response.results[0];

        if (!firstImage) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No images found for "${input.query}" on Unsplash.`,
          });
        }

        console.log("Unsplash result:", firstImage);

        return {
          id: firstImage.id,
          url: firstImage.urls.regular,
          altText:
            firstImage.alt_description ?? firstImage.description ?? input.query,
          downloadLocation: firstImage.links.download_location,
          attribution: {
            authorName: firstImage.user.name,
            authorUrl: `${firstImage.user.links.html}?utm_source=${env.NEXT_PUBLIC_UNSPLASH_APP_NAME}&utm_medium=referral`,
          },
          unsplashUrl: `https://unsplash.com?utm_source=${env.NEXT_PUBLIC_UNSPLASH_APP_NAME}&utm_medium=referral`,
        };
      } catch (error) {
        console.error("Unsplash API Error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An unknown error occurred while searching images.",
          cause: error,
        });
      }
    }),

  // Updated searchUnsplash mutation for pagination
  searchUnsplash: protectedProcedure
    .input(SearchUnsplashInput)
    .mutation(async ({ input }) => {
      const { query, page, perPage } = input;
      console.log(
        `Searching Unsplash for: ${query}, page: ${page}, perPage: ${perPage}`,
      );

      const unsplash = getUnsplash();
      if (!unsplash) {
        console.error(
          "Unsplash client is not initialized. Check server setup and UNSPLASH_ACCESS_KEY.",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Image search service is unavailable.",
        });
      }

      try {
        const result = await unsplash.search.getPhotos({
          query: query,
          page: page,
          perPage: perPage,
        });

        if (result.errors || !result.response) {
          console.error("Error fetching from Unsplash:", result.errors);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Error fetching images from Unsplash: ${result.errors?.join(", ")}`,
          });
        }

        const resultsWithAttribution = result.response.results.map((img) => ({
          id: img.id,
          url: img.urls.regular,
          thumbUrl: img.urls.thumb,
          altText: img.alt_description ?? img.description ?? query,
          downloadLocation: img.links.download_location,
          attribution: {
            authorName: img.user.name,
            authorUrl: `${img.user.links.html}?utm_source=${env.NEXT_PUBLIC_UNSPLASH_APP_NAME}&utm_medium=referral`,
          },
          unsplashUrl: `https://unsplash.com?utm_source=${env.NEXT_PUBLIC_UNSPLASH_APP_NAME}&utm_medium=referral`,
        }));

        return {
          results: resultsWithAttribution,
          totalPages: result.response.total_pages,
        };
      } catch (error) {
        console.error("Unsplash API search error:", error);
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An unknown error occurred while searching Unsplash.",
          cause: error,
        });
      }
    }),

  // New mutation to track Unsplash photo download
  trackUnsplashDownload: protectedProcedure
    .input(TrackDownloadInput)
    .mutation(async ({ input }) => {
      const { downloadLocation } = input;

      const unsplash = getUnsplash();
      if (!unsplash) {
        console.error(
          "Unsplash client is not initialized. Cannot track download.",
        );
        // We might not want to throw an error here, just log it,
        // as failing to track might not be a critical failure for the user.
        return { success: false, error: "Unsplash client not initialized." };
      }

      try {
        console.log(
          `Tracking Unsplash download via location: ${downloadLocation}`,
        );
        // Call the official method to track the download using the location
        const result = await unsplash.photos.trackDownload({
          downloadLocation,
        });

        // Check for errors from the trackDownload call if the library provides them
        // (Example structure, adjust based on actual library response)
        if (result.errors) {
          console.error(
            `Failed to track download via location ${downloadLocation}:`,
            result.errors,
          );
          return {
            success: false,
            error: `Failed to track download: ${result.errors.join(", ")}`,
          };
        }

        console.log(
          `Successfully tracked download via location: ${downloadLocation}`,
        );
        return { success: true };
      } catch (error) {
        console.error(
          `Error tracking Unsplash download via location ${downloadLocation}:`,
          error,
        );
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Unknown tracking error",
        };
      }
    }),
});
