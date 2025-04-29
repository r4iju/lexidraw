import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { unsplash } from "~/server/unsplash";
import { TRPCError } from "@trpc/server";
import env from "@packages/env";

const TrackDownloadInput = z.object({
  downloadLocation: z.string().url(),
});

// Updated input schema for search to include pagination
const SearchUnsplashInput = z.object({
  query: z.string().min(1),
  page: z.number().int().min(1).optional().default(1),
  perPage: z.number().int().min(1).max(30).optional().default(10), // Max 30 per Unsplash guidelines
});

export const imageRouter = createTRPCRouter({
  imLuckyUnsplash: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      console.log(`I'm lucky search for: ${input.query}`);

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
