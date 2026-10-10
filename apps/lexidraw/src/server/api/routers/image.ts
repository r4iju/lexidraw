import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getUnsplash } from "~/server/unsplash";
import { TRPCError } from "@trpc/server";
import env from "@packages/env";

// The generated Unsplash schema omits alt_description, but the API returns it.
function altDescription(photo: object): string | null {
  const alt = (photo as { alt_description?: unknown }).alt_description;
  return typeof alt === "string" ? alt : null;
}

const TrackDownloadInput = z.object({
  downloadLocation: z.url(),
});

// Updated input schema for search to include pagination
const SearchUnsplashInput = z.object({
  query: z.string().min(1),
  page: z.number().int().min(1).optional().default(1),
  perPage: z.number().int().min(1).max(30).optional().default(10), // Max 30 per Unsplash guidelines
});

export const imageRouter = createTRPCRouter({
  getAiGenerationStatus: protectedProcedure.query(() => ({
    isConfigured: false,
    reason:
      "Image generation is unavailable until exact capability, account access and complete pricing are verified.",
  })),
  // Retained as a closed compatibility boundary for older web/native clients.
  generateAiImage: protectedProcedure
    .input(
      z.strictObject({
        prompt: z.string().min(1).max(1500),
        size: z.enum(["256x256", "512x512", "1024x1024"]).optional(),
      }),
    )
    .mutation((): { imageBase64: string; mimeType: string } => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Image generation is unavailable. Use the selected power source after capability verification.",
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
        const result = await unsplash.GET("/search/photos", {
          params: { query: { query: input.query, page: 1, per_page: 1 } },
        });

        if (result.error || !result.data || result.data.results.length === 0) {
          console.error("Error fetching from Unsplash:", result.error);
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No images found for "${input.query}" on Unsplash.`,
          });
        }

        const firstImage = result.data.results[0];

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
            altDescription(firstImage) ?? firstImage.description ?? input.query,
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
        const result = await unsplash.GET("/search/photos", {
          params: { query: { query, page, per_page: perPage } },
        });

        if (result.error || !result.data) {
          console.error("Error fetching from Unsplash:", result.error);
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Error fetching images from Unsplash: ${JSON.stringify(result.error)}`,
          });
        }

        const resultsWithAttribution = result.data.results.map((img) => {
          return {
            id: img.id,
            url: img.urls.regular,
            thumbUrl: img.urls.thumb,
            altText: altDescription(img) ?? img.description ?? query,
            downloadLocation: img.links.download_location,
            attribution: {
              authorName: img.user.name,
              authorUrl: `${img.user.links.html}?utm_source=${env.NEXT_PUBLIC_UNSPLASH_APP_NAME}&utm_medium=referral`,
            },
            unsplashUrl: `https://unsplash.com?utm_source=${env.NEXT_PUBLIC_UNSPLASH_APP_NAME}&utm_medium=referral`,
          };
        });

        return {
          results: resultsWithAttribution,
          totalPages: result.data.total_pages,
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
        // download_location is https://api.unsplash.com/photos/{id}/download?ixid=…
        const photoId = new URL(downloadLocation).pathname.split("/")[2];
        if (!photoId) {
          return {
            success: false,
            error: "Invalid Unsplash download location.",
          };
        }
        const result = await unsplash.GET("/photos/{id}/download", {
          params: { path: { id: photoId } },
        });

        if (result.error) {
          console.error(
            `Failed to track download via location ${downloadLocation}:`,
            result.error,
          );
          return {
            success: false,
            error: `Failed to track download: ${JSON.stringify(result.error)}`,
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
