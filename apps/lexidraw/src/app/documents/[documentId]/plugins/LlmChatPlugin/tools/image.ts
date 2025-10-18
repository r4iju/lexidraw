import { tool } from "ai";
import { z } from "zod";
import { useLexicalImageGeneration } from "~/hooks/use-image-generation";
import { useLexicalImageInsertion } from "~/hooks/use-image-insertion";

export const useImageTools = () => {
  const { searchAndInsertImage: searchAndInsertImageFunc } =
    useLexicalImageInsertion();
  const { generateAndInsertImage: generateAndInsertImageFunc } =
    useLexicalImageGeneration();
  const searchAndInsertImage = searchAndInsertImageFunc
    ? tool({
        description:
          "Searches for an image using the provided query on Unsplash and inserts the first result into the document (defaults to block).",
        inputSchema: z.object({
          query: z
            .string()
            .describe("The search query to find an image on Unsplash."),
        }),
        execute: async ({ query }) => {
          try {
            await searchAndInsertImageFunc(query, "block");
            const summary = `Successfully searched and inserted an image related to '${query}'.`;
            // TODO: This *does* mutate state, should we return it?
            // For now, following pattern of not returning state from non-insert tools.
            return { success: true, content: { summary } };
          } catch (error) {
            console.error(
              "Error calling searchAndInsertImage function:",
              error,
            );
            const message =
              error instanceof Error
                ? error.message
                : "Unknown error occurred during image search/insertion.";
            return {
              success: false,
              error: message,
              // Provide error summary in content if needed
              content: {
                summary: `Failed to insert image for query: ${query}`,
              },
            };
          }
        },
      })
    : undefined;
  const generateAndInsertImage = generateAndInsertImageFunc
    ? tool({
        description:
          "Generates an image based on a user prompt and inserts it into the document.",
        inputSchema: z.object({
          prompt: z
            .string()
            .describe(
              "A detailed text description of the image to be generated.",
            ),
        }),
        execute: async ({ prompt }) => {
          try {
            await generateAndInsertImageFunc(prompt);
            const summary = `Successfully generated and inserted an image for the prompt: "${prompt}"`;
            // TODO: This *does* mutate state, should we return it?
            // For now, following pattern of not returning state from non-insert tools.
            return { success: true, content: { summary } };
          } catch (error) {
            console.error("Error executing image generation tool:", error);
            const message =
              error instanceof Error
                ? error.message
                : "Failed to generate or insert image.";
            return {
              success: false,
              error: message,
              content: {
                summary: `Failed to generate image for prompt: ${prompt}`,
              },
            };
          }
        },
      })
    : undefined;

  return {
    searchAndInsertImage,
    generateAndInsertImage,
  };
};
