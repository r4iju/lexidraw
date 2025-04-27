import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { unsplash } from "~/server/unsplash";

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
});
