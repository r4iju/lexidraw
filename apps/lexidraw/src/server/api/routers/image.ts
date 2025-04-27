import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { unsplash } from "~/server/unsplash";

// Input schema for tracking download
const TrackDownloadInput = z.object({
  downloadLocation: z.string().url(),
});

export const imageRouter = createTRPCRouter({
  searchUnsplash: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input }) => {
      console.log(`Searching Unsplash for: ${input.query}`);

      if (!unsplash) {
        console.error(
          "Unsplash client is not initialized. Check server setup and UNSPLASH_ACCESS_KEY.",
        );
        throw new Error("Image search service is unavailable.");
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
          throw new Error(`No images found for "${input.query}" on Unsplash.`);
        }

        const firstImage = result.response.results[0];

        if (!firstImage) {
          throw new Error(`No images found for "${input.query}" on Unsplash.`);
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
            authorUrl: firstImage.user.links.html,
          },
        };
      } catch (error) {
        console.error("Unsplash API Error:", error);
        if (error instanceof Error) {
          if (error.message.includes("No images found")) {
            throw error;
          }
          throw new Error(
            `Failed to search images on Unsplash: ${error.message}`,
          );
        }
        throw new Error("An unknown error occurred while searching images.");
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
