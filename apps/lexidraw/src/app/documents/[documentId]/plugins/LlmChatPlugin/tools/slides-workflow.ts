import { tool } from "ai";
import { z } from "zod";

export const AudienceDataSchema = z.object({
  bigIdea: z
    .string()
    .describe("The single, concise big idea for the presentation."),
  persona: z.string().describe("A summary of the target audience persona."),
  slideCount: z
    .number()
    .int()
    .positive()
    .describe("The recommended number of slides."),
  tone: z
    .string()
    .describe(
      "The recommended tone for the presentation (e.g., Professional and engaging).",
    ),
});

export const LayoutRefinementToolArgsSchema = z.object({
  textBoxes: z
    .array(
      z.object({
        originalBlockIndex: z
          .number()
          .describe(
            "The original 0-based index of the text block this instruction applies to.",
          ),
        x: z
          .number()
          .describe("The x-coordinate of the top-left corner of the text box."),
        y: z
          .number()
          .describe("The y-coordinate of the top-left corner of the text box."),
        width: z.number().describe("The width of the text box."),
        height: z.number().describe("The height of the text box."),
        textAlign: z
          .enum(["left", "center", "right"])
          .optional()
          .describe("The text alignment within the box."),
      }),
    )
    .describe("An array of layout instructions for each text box."),
  visualAssetPlacement: z
    .object({
      x: z
        .number()
        .describe(
          "The x-coordinate of the top-left corner of the visual asset.",
        ),
      y: z
        .number()
        .describe(
          "The y-coordinate of the top-left corner of the visual asset.",
        ),
      width: z.number().describe("The width of the visual asset."),
      height: z.number().describe("The height of the visual asset."),
      zIndex: z
        .number()
        .optional()
        .describe("The stacking order of the visual asset."),
    })
    .nullable()
    .describe(
      "Layout instructions for the visual asset, or null if no visual is present or to be placed.",
    ),
});

export type LayoutRefinementToolArgs = z.infer<
  typeof LayoutRefinementToolArgsSchema
>;

export const useSlideWorkflowTools = () => {
  const saveAudienceDataTool = tool({
    description:
      "Saves the audience plan data including big idea, persona, slide count, and tone.",
    parameters: AudienceDataSchema,
    execute: async (args: z.infer<typeof AudienceDataSchema>) => {
      return { success: true, audienceData: args };
    },
  });

  const applyLayoutRefinementTool = tool({
    description:
      "Applies a precise layout (position and dimensions) to text boxes and visual assets on a slide, based on provided instructions.",
    parameters: LayoutRefinementToolArgsSchema,
    execute: async (args: z.infer<typeof LayoutRefinementToolArgsSchema>) => {
      return {
        success: true,
        layoutArgs: args,
        message: "Layout refinement arguments received and validated.",
      };
    },
  });

  return {
    saveAudienceDataTool,
    applyLayoutRefinementTool,
  };
};
