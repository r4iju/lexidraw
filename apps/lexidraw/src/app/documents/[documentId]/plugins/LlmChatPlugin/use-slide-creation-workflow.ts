import { useState, useCallback, useRef, useMemo } from "react";
import { RuntimeToolMap, useLLM } from "../../context/llm-context";
import { useChatDispatch } from "./llm-chat-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import {
  type DeckStrategicMetadata,
  type SlideStrategicMetadata,
} from "../../nodes/SlideNode/SlideNode";
import { NodeKey } from "lexical";
import { useLexicalTransformation } from "../../context/editors-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useMarkdownTools } from "../../utils/markdown";
import env from "@packages/env";
import { tool } from "ai";
import { z } from "zod";
import { ChartConfigSchema, ChartDataSchema } from "~/lib/schemas";

interface AudienceData {
  bigIdea: string;
  persona: string;
  slideCount: number;
  tone: string;
  timebox: string;
  files?: File[];
  existingDeckNodeKey?: string;
}

interface ResearchData {
  findings: string;
}

interface SlideOutline {
  slideNumber: number;
  title: string;
  keyMessage: string;
  visualIdea: string;
  speakerNotes: string;
  pageId?: string;
  styleHint?: string;
  layoutTemplateHint?: string;
}

interface StoryboardData {
  slides: SlideOutline[];
}

interface SlideContentData {
  pageId: string;
  structuredBodyContent: { type: string; text: string }[];
  refinedSpeakerNotes: string;
}

interface SlideGenerationParams {
  attachCurrentDocument: boolean;
  topic: string;
  who: string;
  outcome: string;
  timebox: string;
  files?: File[];
  existingDeckNodeKey?: string;
}

interface WorkflowThemeSettings {
  templateName?: string;
  colorPalette?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    slideBackground?: string;
    textHeader?: string;
    textBody?: string;
  };
  fonts?: {
    heading?: string;
    body?: string;
    caption?: string;
  };
  logoUrl?: string;
  customTokens?: string;
}

interface VisualAssetData {
  pageId: string;
  assetType: "image" | "chart" | "none";
  visualIdea: string;
  imagePrompt?: string;
  imageUrl?: string;
  imageId?: string;
  chartId?: string;
  chartType?: string;
  styleHint?: string;
  error?: string;
}

interface ToolExecutionResultForMedia {
  success: boolean;
  content?: {
    summary: string;
    newNodeKey?: string;
    updatedEditorStateJson?: string;
  };
  error?: string;
}

class StepError extends Error {
  public rawResponseText?: string;
  public stepName: string;

  constructor(message: string, stepName: string, rawResponseText?: string) {
    super(message);
    this.name = "StepError";
    this.stepName = stepName;
    this.rawResponseText = rawResponseText;
    Object.setPrototypeOf(this, StepError.prototype);
  }
}

const MAX_WORKFLOW_RETRIES = 3;
const MAX_SLIDES_COUNT: number | undefined =
  env.NEXT_PUBLIC_NODE_ENV === "development" ? 2 : undefined;

const AudienceDataSchema = z.object({
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

const saveAudienceDataTool = tool({
  description:
    "Saves the audience plan data including big idea, persona, slide count, and tone.",
  parameters: AudienceDataSchema,
  execute: async (args: z.infer<typeof AudienceDataSchema>) => {
    return { success: true, audienceData: args };
  },
});

const LayoutRefinementTextBoxInstructionSchema = z.object({
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
});

const LayoutRefinementVisualAssetInstructionSchema = z.object({
  x: z
    .number()
    .describe("The x-coordinate of the top-left corner of the visual asset."),
  y: z
    .number()
    .describe("The y-coordinate of the top-left corner of the visual asset."),
  width: z.number().describe("The width of the visual asset."),
  height: z.number().describe("The height of the visual asset."),
  zIndex: z
    .number()
    .optional()
    .describe("The stacking order of the visual asset."),
});

const LayoutRefinementToolArgsSchema = z.object({
  textBoxes: z
    .array(LayoutRefinementTextBoxInstructionSchema)
    .describe("An array of layout instructions for each text box."),
  visualAssetPlacement:
    LayoutRefinementVisualAssetInstructionSchema.nullable().describe(
      "Layout instructions for the visual asset, or null if no visual is present or to be placed.",
    ),
});
type LayoutRefinementToolArgs = z.infer<typeof LayoutRefinementToolArgsSchema>;

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

export function useSlideCreationWorkflow() {
  const [editor] = useLexicalComposerContext();
  const { generateChatResponse } = useLLM();
  const chatDispatch = useChatDispatch();
  const runtimeTools = useRuntimeTools();
  const { getSlideBoxKeyedState } = useLexicalTransformation();
  const { convertEditorStateToMarkdown } = useMarkdownTools();

  const workflowRetryBudgetRef = useRef(MAX_WORKFLOW_RETRIES);

  const [deckNodeKey, setDeckNodeKey] = useState<string | null>(null);
  const [audienceData, setAudienceData] = useState<AudienceData | null>(null);
  const [researchData, setResearchData] = useState<ResearchData | null>(null);
  const [storyboardData, setStoryboardData] = useState<StoryboardData | null>(
    null,
  );
  const [slideContents, setSlideContents] = useState<SlideContentData[] | null>(
    null,
  );
  const [themeSettings, setThemeSettings] =
    useState<WorkflowThemeSettings | null>(null);
  const [visualAssetsData, setVisualAssetsData] = useState<
    VisualAssetData[] | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);

  const addChartToSlidePageWithStructuredDataTool = useMemo(() => {
    if (!runtimeTools.addChartToSlidePage) {
      return null;
    }
    return tool({
      description:
        "Adds a chart to a slide page using structured data for chartData and chartConfig.",
      parameters: z.object({
        deckNodeKey: z.string().describe("The node key of the current deck."),
        slideId: z
          .string()
          .describe("The ID of the slide to add the chart to."),
        chartType: z
          .string()
          .describe("The type of chart (e.g., bar, line, pie)."),
        chartData: ChartDataSchema,
        chartConfig: ChartConfigSchema,
        x: z
          .number()
          .optional()
          .describe("Optional X coordinate for the chart."),
        y: z
          .number()
          .optional()
          .describe("Optional Y coordinate for the chart."),
        width: z.number().optional().describe("Optional width for the chart."),
        height: z
          .number()
          .optional()
          .describe("Optional height for the chart."),
      }),
      execute: async (args) => {
        try {
          const chartDataJSON = JSON.stringify(args.chartData);
          const chartConfigJSON = JSON.stringify(args.chartConfig);

          const result =
            await // @ts-expect-error - runtimeTools.addChartToSlidePage is not typed
            runtimeTools.addChartToSlidePage.execute({
              deckNodeKey: args.deckNodeKey,
              slideId: args.slideId,
              chartType: args.chartType,
              chartDataJSON,
              chartConfigJSON,
              x: args.x,
              y: args.y,
              width: args.width,
              height: args.height,
            });
          return result as ToolExecutionResultForMedia;
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(
            "Error executing addChartToSlidePageWithStructuredDataTool:",
            errorMsg,
          );
          return {
            success: false,
            error: `Failed to execute underlying chart tool: ${errorMsg}`,
          };
        }
      },
    });
  }, [runtimeTools.addChartToSlidePage]);

  const executeStepWithRetries = useCallback(
    async <ArgType extends { errorContext?: string }, ReturnValue>(
      stepFunction: (args: ArgType) => Promise<ReturnValue>,
      stepName: string,
      initialArgs: Omit<ArgType, "errorContext">,
    ): Promise<ReturnValue> => {
      let lastError: StepError | Error | null = null;
      let currentErrorContext: string | undefined = undefined;

      while (workflowRetryBudgetRef.current > 0) {
        try {
          const stepArgsObject = {
            ...initialArgs,
            ...(currentErrorContext && { errorContext: currentErrorContext }),
          } as ArgType;

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Executing step: ${stepName}${currentErrorContext ? " (with error context from previous attempt)" : ""}. Retries remaining: ${workflowRetryBudgetRef.current}`,
            },
          });

          const result = await stepFunction(stepArgsObject);
          return result;
        } catch (error) {
          workflowRetryBudgetRef.current -= 1;
          lastError = error instanceof Error ? error : new Error(String(error));

          const attemptNumber =
            MAX_WORKFLOW_RETRIES - workflowRetryBudgetRef.current;

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Attempt ${attemptNumber}/${MAX_WORKFLOW_RETRIES} for step ${stepName} failed. Error: ${lastError.message}. Retries left: ${workflowRetryBudgetRef.current}.`,
            },
          });

          if (error instanceof StepError && error.rawResponseText) {
            currentErrorContext = `Previous attempt for ${stepName} failed with error: ${error.message}. The raw response was: "${error.rawResponseText}". Please analyze this and try a different approach.`;
          } else if (error instanceof Error) {
            currentErrorContext = `Previous attempt for ${stepName} failed with error: ${error.message}. Please try a different approach.`;
          }

          if (workflowRetryBudgetRef.current <= 0) {
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content: `Step ${stepName} failed after ${MAX_WORKFLOW_RETRIES} attempts. No retries left. Workflow will halt. Final error: ${lastError.message}`,
              },
            });
            throw lastError;
          }
        }
      }
      if (lastError) throw lastError;
      throw new Error(
        `Step ${stepName} failed critically after exhausting retries.`,
      );
    },
    [chatDispatch],
  );

  const runStep1_AudiencePlanner = useCallback(
    async (args: {
      topic: string;
      who: string;
      outcome: string;
      timebox: string;
      currentDocumentMarkdown?: string;
      errorContext?: string;
    }): Promise<AudienceData> => {
      const {
        topic,
        who,
        outcome,
        timebox,
        currentDocumentMarkdown,
        errorContext,
      } = args;
      const stepName = "AudiencePlanner";

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 1: ${stepName}...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      const prompt = `You are the *Audience Planner*.
Topic: "${topic}"
Audience: ${who}
Outcome: ${outcome}
Time-box: ${timebox}
${
  currentDocumentMarkdown
    ? `\nThe user has provided the following document as context:\\n${currentDocumentMarkdown}\\n`
    : ""
}
${
  errorContext
    ? `\nImportant Context from Previous Attempt:\\n${errorContext}\\n`
    : ""
}
▶︎ Call the "saveAudienceDataTool" with the following arguments derived from your analysis:
- "bigIdea": Your concise big idea for the presentation.
- "persona": A summary of the audience persona.
- "slideCount": A recommended number of slides (integer).
- "tone": The recommended tone for the presentation (e.g., "Professional and engaging").

  Your entire response must be a single call to the "saveAudienceDataTool" tool.`;

      let rawResponseText = "N/A";
      try {
        const response = await generateChatResponse({
          prompt,
          tools: {
            // @ts-expect-error - saveAudienceDataTool is not typed
            saveAudienceDataTool,
          },
        });

        if (
          response.toolCalls &&
          response.toolCalls[0]?.toolName === "saveAudienceDataTool"
        ) {
          const parsedDataFromTool = response.toolCalls[0].args as z.infer<
            typeof AudienceDataSchema
          >;

          const finalAudienceData: AudienceData = {
            ...parsedDataFromTool,
            timebox,
          };

          setAudienceData(finalAudienceData);
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Step 1 Complete: Audience Plan
Big Idea: \${finalAudienceData.bigIdea}
Persona: \${finalAudienceData.persona}
Slide Count: \${finalAudienceData.slideCount}
Tone: \${finalAudienceData.tone}`,
            },
          });
          return finalAudienceData;
        } else {
          rawResponseText =
            response.text ||
            `LLM called an unexpected tool or no tool. Expected 'saveAudienceDataTool'. Got: ${response.toolCalls?.[0]?.toolName || "none"}`;
          throw new StepError(rawResponseText, stepName, rawResponseText);
        }
      } catch (error) {
        if (error instanceof StepError) throw error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new StepError(
          `Error in ${stepName}: ${errorMsg}`,
          stepName,
          rawResponseText,
        );
      }
    },
    [chatDispatch, generateChatResponse],
  );

  const runStep2_StyleStylist = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      currentAudienceData: AudienceData | null;
      errorContext?: string;
    }): Promise<WorkflowThemeSettings> => {
      const { currentDeckNodeKey, currentAudienceData, errorContext } = args;
      const stepName = "StyleStylist";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 2: Brand & Style Stylist...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      if (
        !runtimeTools.saveThemeStyleSuggestions ||
        !runtimeTools.setDeckMetadata
      ) {
        throw new Error(
          "Required tools (saveThemeStyleSuggestions, setDeckMetadata) are not available for Style Stylist.",
        );
      }

      const userObjectiveInfo = currentAudienceData
        ? `The presentation's big idea is: "${currentAudienceData.bigIdea}". It is for persona: "${currentAudienceData.persona}" and should have a "${currentAudienceData.tone}" tone.`
        : "The presentation context is not fully defined.";

      const prompt = `You are an expert Brand & Style Specialist.
${userObjectiveInfo}
${errorContext ? `\n\nImportant Context from Previous Attempt:\n\n${errorContext}\n\n` : ""}
Suggest a comprehensive visual theme for this presentation. Your suggestions should include:
1.  A "templateName" or general style description (e.g., 'Modern Minimalist', 'Tech Professional', 'Vibrant Startup').
2.  A "colorPalette" with hex codes for: 'primary', 'secondary', 'accent', 'slideBackground', 'textHeader', 'textBody'.
3.  "fonts" with font family names for: 'heading', 'body', 'caption'.
4.  Optionally, a "logoUrl" if you think a placeholder logo would be appropriate (use a generic placeholder URL if so).
5.  Optionally, any "customTokens" as a JSON string for further theme refinements (e.g., specific border styles, shadow effects). Example: '{"cardBorderRadius": "8px"}'.

  Your response MUST be a call to the "saveThemeStyleSuggestions" tool, providing these details as arguments. Ensure all color codes are valid hex (e.g., #RRGGBB).`;
      let rawResponseText = "N/A";

      try {
        const response = await generateChatResponse({
          prompt,
          tools: {
            saveThemeStyleSuggestions: runtimeTools.saveThemeStyleSuggestions,
          },
        });
        rawResponseText = response.text || "No text content in response.";

        if (
          response.toolCalls &&
          response.toolCalls[0]?.toolName === "saveThemeStyleSuggestions"
        ) {
          const suggestedTheme = response.toolCalls[0]
            .args as WorkflowThemeSettings;

          setThemeSettings(suggestedTheme);

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Updating deck metadata with new theme settings for deck: ${currentDeckNodeKey}...`,
            },
          });

          // @ts-expect-error - setDeckMetadata is not typed
          const setMetadataResult = await runtimeTools.setDeckMetadata.execute({
            deckNodeKey: currentDeckNodeKey,
            deckMetadata: { theme: suggestedTheme },
          });

          if (!setMetadataResult.success) {
            const metadataError = `Failed to set deck theme metadata: ${setMetadataResult.error || "Unknown error"}`;
            console.warn(metadataError);
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content: `Warning: Could not set deck theme metadata. ${setMetadataResult.error || "Unknown error"}`,
              },
            });
          }

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Step 2 Complete: Style Stylist suggested theme: ${suggestedTheme.templateName || "Custom Theme"}.`,
            },
          });
          return suggestedTheme;
        } else {
          throw new StepError(
            "Expected tool call 'saveThemeStyleSuggestions', but received different or no tool call.",
            stepName,
            rawResponseText,
          );
        }
      } catch (e) {
        if (e instanceof StepError) throw e;
        const errorMsg = e instanceof Error ? e.message : String(e);
        throw new StepError(
          `Error in ${stepName}: ${errorMsg}`,
          stepName,
          rawResponseText,
        );
      }
    },
    [chatDispatch, generateChatResponse, runtimeTools],
  );

  const runStep3_ResearchAgent = useCallback(
    async (args: {
      audienceDataParam: AudienceData;
      files?: File[];
      currentDocumentMarkdown?: string;
      errorContext?: string;
    }): Promise<ResearchData> => {
      const {
        audienceDataParam,
        files,
        currentDocumentMarkdown,
        errorContext,
      } = args;
      const stepName = "ResearchAgent";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 3: ${stepName}...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      const documentContextInfo = currentDocumentMarkdown
        ? `

Additional context from the user's current document is available:
---BEGIN DOCUMENT CONTEXT---
${currentDocumentMarkdown}
---END DOCUMENT CONTEXT---
This document can be referenced as "the provided document context".
`
        : "";

      const filesInfo =
        files && files.length > 0
          ? `The following files have also been provided: ${files.map((f) => f.name).join(", ")}.`
          : "No additional files were provided.";

      const prompt = `You are the *Research Agent*.
Your task is to extract and synthesize key information to support the creation of a presentation.
The presentation's Big Idea: "${audienceDataParam.bigIdea}"
Target Audience Persona: "${audienceDataParam.persona}"

${documentContextInfo}${filesInfo}
${
  errorContext
    ? `
Important Context from Previous Attempt:
${errorContext}
`
    : ""
}
Based on the Big Idea, audience persona, and any provided document context or files, identify and list key research findings.
These findings should directly inform the content of the presentation slides.
▶︎ Return your findings as clear, concise bullet points. If possible, organize them by potential themes or topics relevant to the presentation structure.
If specific data or facts are drawn from the "provided document context" or named files, try to implicitly ground your findings in that information.`;
      let rawResponseText = "N/A";

      try {
        const response = await generateChatResponse({
          prompt,
          files,
        });

        if (!response.text) {
          rawResponseText = "Research Agent did not return text.";
          throw new StepError(rawResponseText, stepName, rawResponseText);
        }
        rawResponseText = response.text;
        const findings = response.text;
        setResearchData({ findings });
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Step 3 Complete: Research Findings\n${findings}`,
          },
        });
        return { findings };
      } catch (error) {
        if (error instanceof StepError) throw error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new StepError(
          `Error in ${stepName}: ${errorMsg}`,
          stepName,
          rawResponseText,
        );
      }
    },
    [chatDispatch, generateChatResponse],
  );

  const runStep4_StoryboardArchitect = useCallback(
    async (args: {
      researchDataParam: ResearchData;
      slideCount: number;
      resolvedDeckKeyForThisStep: string;
      errorContext?: string;
    }): Promise<StoryboardData> => {
      const {
        researchDataParam,
        slideCount,
        resolvedDeckKeyForThisStep,
        errorContext,
      } = args;
      const stepName = "StoryboardArchitect";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 4: ${stepName} (target: ${slideCount} slides) for deck ${resolvedDeckKeyForThisStep}.${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      const prompt =
        `You are an expert *Storyboard Architect* and visual designer.
        Based on the following research findings:
        ---
        ${researchDataParam.findings}
        ---
        Create a compelling and visually diverse storyboard for a presentation with approximately ${slideCount} slides.

        For each slide, you MUST define:
        1.  slideNumber: (integer)
        2.  title: (string)
        3.  keyMessage: (string, markdown for bullets)
        4.  visualIdea: (string, "None" if not applicable)
        5.  speakerNotes: (string)
        6.  layoutTemplateHint: (string) **Critically evaluate the slide's purpose to choose the best hint.** Strive for variety. Do not overuse 'standard-text-visual'.
            * Use 'title-slide' for the main title.
            * Use 'chapter-divider' for section breaks.
            * Use 'quote-focus' for a single, impactful message.
            * Use 'full-width-visual' if the visual is the hero.
            * Use 'text-overlay-visual' if text can be placed on a background image.
            * Use 'standard-text-visual' or 'visual-text' only for standard content slides.

        ${errorContext ? `\nImportant Context from Previous Attempt:\n${errorContext}\n` : ""}

        ▶︎ Your response MUST be a single tool call to "saveStoryboardOutput" with a valid JSON array for the "slides" argument, including all six fields for each slide.
        `.replaceAll("        ", "");

      let rawResponseText = "N/A";

      if (!runtimeTools.saveStoryboardOutput) {
        throw new Error(
          "saveStoryboardOutput tool is not available for StoryboardArchitect.",
        );
      }
      if (!runtimeTools.addSlidePage) {
        throw new Error(
          "addSlidePage tool is not available for StoryboardArchitect.",
        );
      }

      try {
        const response = await generateChatResponse({
          prompt,
          tools: {
            saveStoryboardOutput: runtimeTools.saveStoryboardOutput,
          } as RuntimeToolMap,
        });
        rawResponseText = response.text || "No text content in LLM response.";

        if (response.toolCalls && response.toolCalls.length > 0) {
          const toolCall = response.toolCalls[0];
          if (toolCall && toolCall.toolName === "saveStoryboardOutput") {
            const { slides: parsedSlideOutlines } = toolCall.args as {
              slides: SlideOutline[];
            };

            if (
              !Array.isArray(parsedSlideOutlines) ||
              parsedSlideOutlines.length === 0
            ) {
              throw new StepError(
                "saveStoryboardOutput tool did not receive a valid array of slides.",
                stepName,
                JSON.stringify(toolCall.args),
              );
            }

            const createdSlidesInfo: SlideOutline[] = [];
            let slideCreationErrors = 0;

            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content: `Processing ${parsedSlideOutlines.length} slide outlines to create pages...`,
              },
            });

            for (const outline of parsedSlideOutlines) {
              const pageId = `${resolvedDeckKeyForThisStep}-slide-${outline.slideNumber}-${crypto.randomUUID().substring(0, 8)}`;
              const slideMetadataForPage: SlideStrategicMetadata = {
                storyboardTitle: outline.title,
                keyMessage: outline.keyMessage,
                keyVisualHint: outline.visualIdea,
                speakerNotes: outline.speakerNotes,
                layoutTemplateHint: outline.layoutTemplateHint,
              };
              // @ts-expect-error - addSlidePage is not typed
              const addPageResult = await runtimeTools.addSlidePage.execute({
                deckNodeKey: resolvedDeckKeyForThisStep,
                newSlideId: pageId,
                slideMetadata: slideMetadataForPage,
                focusNewSlide: false,
              });

              if (addPageResult.success) {
                chatDispatch({
                  type: "push",
                  msg: {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: `Slide page ${outline.slideNumber} ("${outline.title}") created with ID: ${pageId}.`,
                  },
                });
                createdSlidesInfo.push({ ...outline, pageId });
              } else {
                slideCreationErrors++;
                const creationErrorMsg = `Error creating slide page ${outline.slideNumber} ("${outline.title}"): ${addPageResult.error || "Unknown error"}`;
                chatDispatch({
                  type: "push",
                  msg: {
                    id: crypto.randomUUID(),
                    role: "system",
                    content: creationErrorMsg,
                  },
                });
                console.error(
                  `Error creating slide page for outline: ${JSON.stringify(outline)}`,
                  addPageResult.error,
                );
              }
            }

            if (slideCreationErrors > 0) {
              chatDispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "system",
                  content: `Warning: ${slideCreationErrors} slide page(s) could not be created within ${stepName}.`,
                },
              });
            }

            const finalStoryboardData = { slides: createdSlidesInfo };
            setStoryboardData(finalStoryboardData);

            const summary = createdSlidesInfo
              .map(
                (s) =>
                  `  Slide ${s.slideNumber} (${s.pageId ? "ID: " + s.pageId.slice(-8) : "Creation Failed"}): ${s.title}`,
              )
              .join("\n");

            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Step 4 Complete: ${stepName} processed and ${createdSlidesInfo.length} slide pages created (with ${slideCreationErrors} errors).\nOutline & Page IDs:\n${summary.substring(0, 1000)}${summary.length > 1000 ? "..." : ""}`,
              },
            });
            return finalStoryboardData;
          } else {
            throw new StepError(
              `${stepName} called an unexpected tool or no tool for storyboard output. Expected 'saveStoryboardOutput'. Got: ${toolCall?.toolName || "none"}`,
              stepName,
              JSON.stringify(toolCall?.args),
            );
          }
        } else {
          throw new StepError(
            `${stepName} did not use the saveStoryboardOutput tool as instructed. Raw response: ${rawResponseText}`,
            stepName,
            rawResponseText,
          );
        }
      } catch (error) {
        if (error instanceof StepError) throw error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new StepError(
          `Error in ${stepName}: ${errorMsg}`,
          stepName,
          rawResponseText,
        );
      }
    },
    [chatDispatch, generateChatResponse, runtimeTools],
  );

  const runStep5_SlideWriter = useCallback(
    async (args: {
      storyboardDataParam: StoryboardData;
      currentDeckNodeKey: string;
      errorContext?: string;
    }): Promise<SlideContentData[]> => {
      const { storyboardDataParam, currentDeckNodeKey, errorContext } = args;
      const stepName = "SlideWriter";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 5: ${stepName} - Generating structured content for each slide...${errorContext ? " (Retrying with error context for the step)" : ""}`,
        },
      });
      const generatedContents: SlideContentData[] = [];
      let contentGenerationErrors = 0;
      let individualSlideErrorContext = errorContext;

      if (
        !runtimeTools.saveSlideContentAndNotes ||
        !runtimeTools.setSlideMetadata
      ) {
        throw new Error(
          "One or more required tools (saveSlideContentAndNotes, setSlideMetadata) are not available for Slide Writer.",
        );
      }

      for (const slideOutline of storyboardDataParam.slides) {
        if (!slideOutline.pageId) {
          contentGenerationErrors++;
          console.warn(
            `Skipping slide ${slideOutline.slideNumber} in ${stepName} as it has no pageId.`,
          );
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Skipping slide ${slideOutline.slideNumber} ('${slideOutline.title}') for content generation: missing pageId.`,
            },
          });
          continue;
        }

        const initialMetadata = slideOutline;
        const prompt = `You are an expert slide content writer.
Slide Title: "${initialMetadata.title}"
Key Message Points: "${initialMetadata.keyMessage}"
Initial Speaker Notes: "${initialMetadata.speakerNotes || "None"}"
Target Audience: [Consider inferring from deck-level metadata if available, or make a general assumption for a professional presentation]
${individualSlideErrorContext ? `\nImportant Context from Previous Attempt for this slide (or step):\n${individualSlideErrorContext}\n` : ""}
Based on the above, generate the primary content for the body of this slide and refine the speaker notes.
The slide body content should be provided as a JSON array of content block objects. Each block object must have a "type" (string) and a "text" (string) property.
Valid types are: "heading1", "heading2", "paragraph", "bulletList".
For "bulletList", the "text" property should be a single string with items separated by newlines (e.g., "Item 1\nItem 2").

Example of the "bodyContent" argument value:
[{"type": "heading2", "text": "Key Achievements"}, {"type": "bulletList", "text": "Launched Product X\\nReached 1M Users\\nSecured Series A Funding"}]

Your response MUST be a call to the "saveSlideContentAndNotes" tool, providing the following arguments:
- "pageId": "${slideOutline.pageId}"
- "bodyContent": (JSON array of objects, the structured content as described above)
- "refinedSpeakerNotes": (string, your improved speaker notes for this slide)
Do NOT call any other tools, such as styling tools. Your sole purpose is to provide content via the "saveSlideContentAndNotes" tool.`;
        let rawResponseText = "N/A";

        try {
          const response = await generateChatResponse({
            prompt,
            tools: {
              saveSlideContentAndNotes: runtimeTools.saveSlideContentAndNotes,
            },
          });
          rawResponseText =
            response.text || "No text from LLM for slide content.";

          if (
            response.toolCalls &&
            response.toolCalls.length > 0 &&
            response.toolCalls[0]?.toolName === "saveSlideContentAndNotes"
          ) {
            const toolArgs = response.toolCalls[0].args as {
              pageId: string;
              bodyContent: { type: string; text: string }[];
              refinedSpeakerNotes: string;
            };

            const metadataUpdateResult =
              // @ts-expect-error - setSlideMetadata is not typed
              await runtimeTools.setSlideMetadata.execute({
                deckNodeKey: currentDeckNodeKey,
                slideId: toolArgs.pageId,
                slideMetadata: {
                  structuredBodyContent: JSON.stringify(toolArgs.bodyContent),
                  speakerNotes: toolArgs.refinedSpeakerNotes,
                },
              });

            if (!metadataUpdateResult.success) {
              console.warn(
                `Failed to set metadata (structuredBodyContent, speakerNotes) for slide ${toolArgs.pageId}: ${metadataUpdateResult.error}`,
              );
            }

            generatedContents.push({
              pageId: toolArgs.pageId,
              structuredBodyContent: toolArgs.bodyContent,
              refinedSpeakerNotes: toolArgs.refinedSpeakerNotes,
            });

            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Structured content and notes saved for slide ${slideOutline.slideNumber} (pageId: ${toolArgs.pageId}).`,
              },
            });
            individualSlideErrorContext = undefined;
          } else {
            contentGenerationErrors++;
            const toolErrorMsg = `Expected tool call 'saveSlideContentAndNotes' for slide ${slideOutline.pageId}, but received different or no tool call.`;
            console.error(toolErrorMsg, "Raw LLM Response:", rawResponseText);
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content: `${toolErrorMsg} LLM raw response: ${rawResponseText.substring(0, 150)}...`,
              },
            });
            individualSlideErrorContext = `Failed on slide ${slideOutline.slideNumber} (${slideOutline.title}): ${toolErrorMsg}. Raw LLM Response: ${rawResponseText.substring(0, 150)}`;
            throw new StepError(
              toolErrorMsg,
              `${stepName} - Slide ${slideOutline.slideNumber}`,
              rawResponseText,
            );
          }
        } catch (e) {
          if (e instanceof StepError) throw e;

          contentGenerationErrors++;
          const errorMsg = e instanceof Error ? e.message : String(e);
          const detailedErrorMsg = `Error processing slide ${slideOutline.slideNumber} (pageId: ${slideOutline.pageId}) in ${stepName}: ${errorMsg}`;
          console.error(
            detailedErrorMsg,
            "Raw LLM response was:",
            rawResponseText,
          );
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `${detailedErrorMsg} Raw LLM response: ${rawResponseText.substring(0, 200)}...`,
            },
          });
          throw new StepError(
            detailedErrorMsg,
            `${stepName} - Slide ${slideOutline.slideNumber}`,
            rawResponseText,
          );
        }
      }

      if (contentGenerationErrors > 0 && generatedContents.length === 0) {
        throw new StepError(
          `All ${storyboardDataParam.slides.length} slides failed content generation in ${stepName}.`,
          stepName,
          `Total errors: ${contentGenerationErrors}`,
        );
      }
      if (contentGenerationErrors > 0) {
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: `Warning: Structured content generation for ${contentGenerationErrors} slide(s) encountered errors during ${stepName}.`,
          },
        });
      }

      setSlideContents(generatedContents);
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 5 Complete: ${stepName} finished generating structured content for ${generatedContents.length} slides (with ${contentGenerationErrors} errors during the last attempt).`,
        },
      });
      return generatedContents;
    },
    [chatDispatch, generateChatResponse, runtimeTools, setSlideContents],
  );

  const runStep6_MediaGenerator = useCallback(
    async (args: {
      storyboardDataParam: StoryboardData;
      currentDeckNodeKey: string;
      currentThemeSettings: WorkflowThemeSettings | null;
      errorContext?: string;
    }): Promise<VisualAssetData[]> => {
      const {
        storyboardDataParam,
        currentDeckNodeKey,
        currentThemeSettings,
        errorContext,
      } = args;
      const stepName = "MediaGenerator";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 6: ${stepName}...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      const generatedAssets: VisualAssetData[] = [];
      let assetGenerationErrors = 0;
      let individualAssetErrorContext = errorContext;

      if (
        !runtimeTools.saveImageGenerationRequest ||
        !addChartToSlidePageWithStructuredDataTool
      ) {
        throw new Error(
          "Required tools (saveImageGenerationRequest, addChartToSlidePageWithStructuredDataTool) are not available for Media Generator.",
        );
      }

      const themeStyleHint = currentThemeSettings?.templateName
        ? ` The overall presentation style is '${currentThemeSettings.templateName}'.`
        : "";
      const themeColorsHint = currentThemeSettings?.colorPalette
        ? ` Key theme colors are: ${JSON.stringify(currentThemeSettings.colorPalette)}.`
        : "";

      for (const slideOutline of storyboardDataParam.slides) {
        let rawResponseText = "N/A";
        if (!slideOutline.pageId) {
          console.warn(
            `Skipping media generation for slide ${slideOutline.slideNumber} ('${slideOutline.title}') in ${stepName} as it has no pageId.`,
          );
          generatedAssets.push({
            pageId: "unknown",
            visualIdea: slideOutline.visualIdea,
            assetType: "none",
            error: "Missing pageId",
          });
          assetGenerationErrors++;
          continue;
        }
        if (
          !slideOutline.visualIdea ||
          slideOutline.visualIdea.trim().toLowerCase() === "none" ||
          slideOutline.visualIdea.trim() === ""
        ) {
          generatedAssets.push({
            pageId: slideOutline.pageId,
            visualIdea: slideOutline.visualIdea,
            assetType: "none",
          });
          continue;
        }

        const prompt = `You are a Visual Asset Coordinator.
For slide ${slideOutline.slideNumber} titled "${slideOutline.title}", the visual idea is: "${slideOutline.visualIdea}".
${themeStyleHint}${themeColorsHint}
${individualAssetErrorContext ? `\nImportant Context from Previous Attempt for this visual (or step):${individualAssetErrorContext}\n` : ""}
Based on this, decide if an image or a chart is most appropriate.

1.  If an IMAGE is best:
    *   Craft a concise, descriptive prompt for an image generation model (like DALL-E). The prompt should incorporate the visual idea and relevant style hints.
    *   Call the "saveImageGenerationRequest" tool with arguments: "pageId" (use "${slideOutline.pageId}"), "imagePrompt" (your crafted prompt), and "styleHint" (e.g., derived from theme like '${currentThemeSettings?.templateName || "general"}').

2.  If a CHART (bar, line, pie, etc.) is best:
    *   Determine the "chartType".
    *   Synthesize plausible "chartData" based on the visual idea. This should be an array of data objects suitable for the chart type (e.g., for a bar chart: [{name: "A", value: 10}, ...]). Keep data simple (3-5 data points) unless specified otherwise.
    *   Suggest a simple "chartConfig" object if applicable (e.g., for Recharts, defining colors or labels: {value: {label: "Sales", color: "${currentThemeSettings?.colorPalette?.accent || "#8884d8"}}}). Often an empty object {} is fine.
    *   Call the "addChartToSlidePageWithStructuredDataTool" with arguments: "deckNodeKey" (use "${currentDeckNodeKey}"), "slideId" (use "${slideOutline.pageId}"), "chartType", "chartData", "chartConfig". You can also specify "x", "y", "width", "height" (e.g. x:100, y:200, width:500, height:300) or let the layout engine handle it later. For now, use x:100, y:200, width:500, height:300 if you call this tool.

Choose only ONE tool to call: either "saveImageGenerationRequest" OR "addChartToSlidePageWithStructuredDataTool".`;

        try {
          const response = await generateChatResponse({
            prompt,
            tools: {
              saveImageGenerationRequest:
                runtimeTools.saveImageGenerationRequest,
              // @ts-expect-error - addChartToSlidePageWithStructuredDataTool is not typed
              addChartToSlidePageWithStructuredDataTool:
                addChartToSlidePageWithStructuredDataTool,
            },
          });
          rawResponseText =
            response.text || "No text from LLM for media decision.";

          if (response.toolCalls && response.toolCalls.length > 0) {
            const toolCall = response.toolCalls[0];
            if (toolCall?.toolName === "saveImageGenerationRequest") {
              const toolArgs = toolCall.args as {
                pageId: string;
                imagePrompt: string;
                styleHint?: string;
              };
              generatedAssets.push({
                pageId: toolArgs.pageId,
                assetType: "image",
                visualIdea: slideOutline.visualIdea,
                imagePrompt: toolArgs.imagePrompt,
                styleHint: toolArgs.styleHint,
              });
              chatDispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: `Slide \${slideOutline.slideNumber} (Page ID: \${toolArgs.pageId}): Image generation requested. Prompt: "\${toolArgs.imagePrompt.substring(0, 100)}..."`,
                },
              });
              individualAssetErrorContext = undefined;
            } else if (
              toolCall?.toolName === "addChartToSlidePageWithStructuredDataTool"
            ) {
              const argsFromToolCall = toolCall.args;
              let actualChartId: string | undefined = undefined;
              let assetErrorMsg: string | undefined = undefined;

              if (response.toolResults && response.toolResults.length > 0) {
                const toolResult = response.toolResults.find(
                  (r) => r.toolCallId === toolCall.toolCallId,
                );
                if (toolResult) {
                  const typedToolExecuteResult =
                    toolResult.result as ToolExecutionResultForMedia;
                  if (
                    typedToolExecuteResult.success &&
                    typedToolExecuteResult.content?.newNodeKey
                  ) {
                    actualChartId = typedToolExecuteResult.content.newNodeKey;
                  } else {
                    assetErrorMsg = `Wrapped chart tool for slide ${argsFromToolCall.slideId} did not succeed or return a newNodeKey. Error: ${typedToolExecuteResult.error}`;
                    console.warn(assetErrorMsg, typedToolExecuteResult);
                  }
                } else {
                  assetErrorMsg = `Could not find tool result for addChartToSlidePageWithStructuredDataTool on slide ${argsFromToolCall.slideId}.`;
                  console.warn(assetErrorMsg);
                }
              } else {
                assetErrorMsg = `Expected toolResults for addChartToSlidePageWithStructuredDataTool on slide ${argsFromToolCall.slideId}, but found none.`;
                console.warn(assetErrorMsg);
              }

              if (!actualChartId) {
                const criticalErrorMsg =
                  assetErrorMsg ||
                  `Failed to retrieve a valid newNodeKey for chart on slide ${argsFromToolCall.slideId}.`;
                throw new StepError(
                  criticalErrorMsg,
                  `${stepName} - Chart Creation on Slide ${slideOutline.slideNumber}`,
                  JSON.stringify(response.toolResults),
                );
              }

              generatedAssets.push({
                pageId: argsFromToolCall.slideId,
                assetType: "chart",
                visualIdea: slideOutline.visualIdea,
                chartId: actualChartId,
                chartType: argsFromToolCall.chartType,
                styleHint: slideOutline.styleHint,
                error: assetErrorMsg,
              });
              chatDispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: `Slide ${slideOutline.slideNumber} (Page ID: ${argsFromToolCall.slideId}): Chart "${argsFromToolCall.chartType}" created with ID ${actualChartId}.`,
                },
              });
              individualAssetErrorContext = undefined;
            } else {
              assetGenerationErrors++;
              const unexpectedToolError = `Unexpected tool called by ${stepName} for slide ${slideOutline.slideNumber}: ${toolCall?.toolName || "none"}`;
              individualAssetErrorContext = `${unexpectedToolError}. Raw Response: ${rawResponseText.substring(0, 150)}`;
              throw new StepError(
                unexpectedToolError,
                `${stepName} - Slide ${slideOutline.slideNumber}`,
                rawResponseText,
              );
            }
          } else {
            assetGenerationErrors++;
            const noToolCallError = `Slide ${slideOutline.slideNumber} (Page ID: ${slideOutline.pageId}): No specific media tool called by LLM for visual idea: "${slideOutline.visualIdea}".`;
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content: `${noToolCallError} LLM response: ${rawResponseText}`,
              },
            });
            generatedAssets.push({
              pageId: slideOutline.pageId,
              assetType: "none",
              visualIdea: slideOutline.visualIdea,
              error: "LLM did not call a media tool. " + rawResponseText,
            });
            individualAssetErrorContext = `${noToolCallError}. Raw Response: ${rawResponseText.substring(0, 150)}`;
          }
        } catch (e) {
          if (e instanceof StepError) throw e;

          assetGenerationErrors++;
          const errorMsg = e instanceof Error ? e.message : String(e);
          const detailedErrorMsg = `Error processing media for slide ${slideOutline.slideNumber} (pageId: ${slideOutline.pageId}) in ${stepName}: ${errorMsg}`;
          console.error(
            detailedErrorMsg,
            "Raw LLM response was:",
            rawResponseText,
          );
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `${detailedErrorMsg} Raw LLM Response: ${rawResponseText.substring(0, 200)}...`,
            },
          });
          throw new StepError(
            detailedErrorMsg,
            `${stepName} - Slide ${slideOutline.slideNumber}`,
            rawResponseText,
          );
        }
      }

      const attemptedAssets = storyboardDataParam.slides.filter(
        (s) =>
          s.visualIdea &&
          s.visualIdea.trim().toLowerCase() !== "none" &&
          s.visualIdea.trim() !== "",
      ).length;
      if (
        assetGenerationErrors > 0 &&
        assetGenerationErrors >= attemptedAssets &&
        attemptedAssets > 0
      ) {
        throw new StepError(
          `All ${attemptedAssets} attempted media generations failed in ${stepName}.`,
          stepName,
          `Total errors: ${assetGenerationErrors}`,
        );
      }
      if (assetGenerationErrors > 0) {
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: `Warning: Media generation for ${assetGenerationErrors} slide(s) encountered errors or was skipped during ${stepName}.`,
          },
        });
      }

      setVisualAssetsData(generatedAssets);
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 6 Complete: ${stepName} processed ${generatedAssets.filter((a) => a.assetType !== "none").length} visual ideas (with ${assetGenerationErrors} errors/skips during the last attempt).`,
        },
      });
      return generatedAssets;
    },
    [
      chatDispatch,
      generateChatResponse,
      runtimeTools.saveImageGenerationRequest,
      addChartToSlidePageWithStructuredDataTool,
      setVisualAssetsData,
    ],
  );

  const runStep7_LayoutEngine = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      storyboardDataParam: StoryboardData | null;
      allSlideContents: SlideContentData[] | null;
      allVisualAssets: VisualAssetData[] | null;
      currentThemeSettings: WorkflowThemeSettings | null;
      errorContext?: string;
    }): Promise<void> => {
      const {
        currentDeckNodeKey,
        storyboardDataParam,
        allSlideContents,
        allVisualAssets,
        currentThemeSettings,
        errorContext,
      } = args;
      const stepName = "LayoutEngine";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 7: ${stepName} - LLM-driven layout refinement...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      if (
        !runtimeTools.addBoxToSlidePage ||
        !runtimeTools.updateBoxPropertiesOnSlidePage ||
        !runtimeTools.updateSlideElementProperties ||
        !runtimeTools.applyTextStyle ||
        !runtimeTools.patchNodeByJSON ||
        !generateChatResponse
      ) {
        throw new Error(
          "Required tools or functions for LayoutEngine are not available.",
        );
      }

      if (errorContext) {
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: `Note: ${stepName} is retrying. Previous error: ${errorContext.substring(0, 300)}`,
          },
        });
      }

      const SLIDE_WIDTH = 1280;
      const SLIDE_HEIGHT = 720;
      const PADDING = 50;

      const pageIds = new Set<string>();
      if (allSlideContents)
        allSlideContents.forEach((sc) => pageIds.add(sc.pageId));
      if (allVisualAssets)
        allVisualAssets.forEach((va) => va.pageId && pageIds.add(va.pageId));

      let layoutErrors = 0;

      const dispatchLayoutAction = (message: string) => {
        chatDispatch({
          type: "push",
          msg: { id: crypto.randomUUID(), role: "assistant", content: message },
        });
      };

      interface LayoutRefinementContentBlock {
        type: string;
        textLength: number;
        originalBlockIndex: number;
      }

      function buildLayoutRefinementPrompt(
        pageId: string,
        layoutHint: string | undefined,
        contentBlocksForPrompt: LayoutRefinementContentBlock[],
        visualAssetInfoForPrompt: VisualAssetData | undefined,
        slideWidth: number,
        slideHeight: number,
        padding: number,
      ): string {
        const contentSummary = contentBlocksForPrompt
          .map(
            (b) =>
              `- Type: ${b.type}, Text Length: ${b.textLength}, Block Index: ${b.originalBlockIndex}`,
          )
          .join("\\n");
        const visualDetail = visualAssetInfoForPrompt
          ? `Visual: A ${visualAssetInfoForPrompt.assetType} (ID: ${visualAssetInfoForPrompt.chartId || visualAssetInfoForPrompt.imageId || "N/A"}) is present.`
          : "Visual: None.";

        return `You are an expert Graphic Layout Designer.
Objective: Define the precise placement and sizing (x, y, width, height) for elements on a slide.
Slide Dimensions: ${slideWidth}x${slideHeight}. Maintain a ${padding}px safety padding from the slide edges for primary content. Elements can be full bleed if appropriate for the layoutHint (e.g. background images).

Context for Slide (ID: ${pageId}):
- High-Level Layout Hint: "${layoutHint || "default"}"
- Text Blocks to be placed (identified by originalBlockIndex):
${contentSummary || "- No text blocks provided."}
- ${visualDetail}

Task:
Based on the context, you MUST call the "applyLayoutRefinementTool" with a single argument object.
This object must contain two keys:
1. "textBoxes": An array of objects, where each object defines the layout for a text block. Each text block object needs: "originalBlockIndex", "x", "y", "width", "height", and an optional "textAlign".
2. "visualAssetPlacement": An object defining the layout for the visual asset ("x", "y", "width", "height", optional "zIndex"), or null if no visual is to be placed.

- The (x,y) coordinates are from the top-left of the slide.
- Be strategic. A '${layoutHint}' with a 'heading1' block and a 'paragraph' block should have different heights and positions for each. A title slide's main heading should be large and centered.
- Consider readability, visual hierarchy, and balance. Ensure elements do not unnecessarily overlap unless the hint is 'text-overlay-visual'.
- The sum of element heights and vertical gaps should logically fit within the slide height.

Your entire response MUST be a call to the "applyLayoutRefinementTool" tool.

Example of how to structure the arguments for the tool call (for a 'standard-text-visual' hint):
If you were to call "applyLayoutRefinementTool", the "args" would look like this:
{
  "textBoxes": [
    { "originalBlockIndex": 0, "x": ${padding}, "y": 150, "width": ${slideWidth / 2 - padding - 10}, "height": 100, "textAlign": "left" },
    { "originalBlockIndex": 1, "x": ${padding}, "y": 270, "width": ${slideWidth / 2 - padding - 10}, "height": 300, "textAlign": "left" }
  ],
  "visualAssetPlacement": { "x": ${slideWidth / 2 + 10}, "y": 150, "width": ${slideWidth / 2 - padding - 10}, "height": 420 }
}
  Do NOT just return this example. Calculate the correct values based on the input.`.replaceAll(
          "  ",
          "",
        );
      }

      for (const pageId of pageIds) {
        const slideContentInfo = allSlideContents?.find(
          (sc) => sc.pageId === pageId,
        );
        const visualAssetInfo = allVisualAssets?.find(
          (va) =>
            va.pageId === pageId &&
            (va.assetType === "chart" || va.assetType === "image"),
        );
        const slideStoryboardOutline = storyboardDataParam?.slides.find(
          (s) => s.pageId === pageId,
        );
        const layoutHint =
          slideStoryboardOutline?.layoutTemplateHint?.toLowerCase();

        const createdElements: {
          originalBlockIndex: number;
          boxId: string;
          textNodeKey?: string;
          type: string;
        }[] = [];

        const visualElementId =
          visualAssetInfo?.assetType === "chart"
            ? visualAssetInfo.chartId
            : visualAssetInfo?.imageId;

        dispatchLayoutAction(
          `LayoutEngine: Processing slide ${pageId} with hint '${layoutHint || "default"}'`,
        );

        try {
          let parsedContentBlocks: {
            type: string;
            text: string;
            originalBlockIndex: number;
          }[] = [];

          if (slideContentInfo?.structuredBodyContent) {
            if (Array.isArray(slideContentInfo.structuredBodyContent)) {
              parsedContentBlocks = slideContentInfo.structuredBodyContent.map(
                (block, index) => ({
                  ...block,
                  originalBlockIndex: index,
                }),
              );
            } else {
              layoutErrors++;
              console.error(
                `Internal error: structuredBodyContent for slide ${pageId} is not an array. Found: ${typeof slideContentInfo.structuredBodyContent}`,
              );
              dispatchLayoutAction(
                `Error with structured content for slide ${pageId}. Skipping content layout.`,
              );
            }
          }

          for (const [index, block] of parsedContentBlocks.entries()) {
            if (
              !block ||
              typeof block.text !== "string" ||
              typeof block.type !== "string"
            ) {
              console.warn(
                `[LayoutEngine] Skipping invalid content block on slide ${pageId}:`,
                block,
              );
              layoutErrors++;
              continue;
            }

            // @ts-expect-error - addBoxToSlidePage is not typed
            const boxResult = await runtimeTools.addBoxToSlidePage.execute({
              deckNodeKey: currentDeckNodeKey,
              slideId: pageId,
              x: 0,
              y: 0,
              width: 1,
              height: 1,
            });

            if (boxResult.success && boxResult.content?.newNodeKey) {
              const newBoxId = boxResult.content.newNodeKey;
              const textNodeOriginalKeyFromEmptyContent = (
                boxResult.content as unknown as { textNodeKey?: string }
              )?.textNodeKey;

              createdElements.push({
                originalBlockIndex: index,
                boxId: newBoxId,
                textNodeKey: textNodeOriginalKeyFromEmptyContent,
                type: block.type,
              });

              const fullEditorKeyForBox = `${currentDeckNodeKey}/${pageId}/${newBoxId}`;

              if (
                textNodeOriginalKeyFromEmptyContent &&
                block.text.trim() !== ""
              ) {
                // @ts-expect-error - patchNodeByJSON is not typed
                const patchResult = await runtimeTools.patchNodeByJSON.execute({
                  editorKey: fullEditorKeyForBox,
                  nodeKey: textNodeOriginalKeyFromEmptyContent,
                  patchProperties: [{ key: "text", value: block.text }],
                });

                if (patchResult.success) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                  let actualTextNodeKeyForStyling: NodeKey | undefined;
                  if (editor) {
                    const currentPersistedBoxState = getSlideBoxKeyedState(
                      editor,
                      currentDeckNodeKey,
                      pageId,
                      newBoxId,
                    );
                    if (
                      currentPersistedBoxState?.root?.children?.[0]
                        ?.children?.[0]?.key
                    ) {
                      actualTextNodeKeyForStyling =
                        currentPersistedBoxState.root.children[0].children[0]
                          .key;
                    } else {
                      actualTextNodeKeyForStyling =
                        textNodeOriginalKeyFromEmptyContent;
                    }
                  } else {
                    actualTextNodeKeyForStyling =
                      textNodeOriginalKeyFromEmptyContent;
                  }

                  let fontSize = "1em";
                  let fontWeight = "normal";
                  const fontStyle = "normal";
                  let fontFamily = currentThemeSettings?.fonts?.body;
                  let color = currentThemeSettings?.colorPalette?.textBody;
                  switch (block.type) {
                    case "heading1":
                      fontFamily =
                        currentThemeSettings?.fonts?.heading || fontFamily;
                      color =
                        currentThemeSettings?.colorPalette?.textHeader || color;
                      fontSize = "2em";
                      fontWeight = "bold";
                      break;
                    case "heading2":
                      fontFamily =
                        currentThemeSettings?.fonts?.heading || fontFamily;
                      color =
                        currentThemeSettings?.colorPalette?.textHeader || color;
                      fontSize = "1.5em";
                      fontWeight = "bold";
                      break;
                  }
                  // @ts-expect-error - applyTextStyle is not typed
                  const styleResult = await runtimeTools.applyTextStyle.execute(
                    {
                      anchorKey: actualTextNodeKeyForStyling,
                      editorKey: fullEditorKeyForBox,
                      fontFamily,
                      fontSize,
                      fontWeight,
                      fontStyle,
                      color,
                      backgroundColor: undefined,
                    },
                  );
                  if (!styleResult.success) {
                    console.error(
                      `[LayoutEngine] Failed to apply style for box ${newBoxId}: ${styleResult.error}`,
                    );
                    layoutErrors++;
                  }
                } else {
                  layoutErrors++;
                }
              } else if (!textNodeOriginalKeyFromEmptyContent) {
                layoutErrors++;
                console.error(
                  `[LayoutEngine] Failed to retrieve textNodeKey for new box ${newBoxId}.`,
                );
              }
            } else {
              layoutErrors++;
              console.error(
                `[LayoutEngine] Failed to create content box for slide ${pageId}, block type ${block.type}: ${boxResult.error}`,
              );
            }
          }

          const contentBlocksForPrompt: LayoutRefinementContentBlock[] =
            parsedContentBlocks.map((block, idx) => ({
              type: block.type,
              textLength: block.text.length,
              originalBlockIndex: idx,
            }));

          const refinementPrompt = buildLayoutRefinementPrompt(
            pageId,
            layoutHint,
            contentBlocksForPrompt,
            visualAssetInfo,
            SLIDE_WIDTH,
            SLIDE_HEIGHT,
            PADDING,
          );

          dispatchLayoutAction(
            `Calling Layout Refinement Agent for slide ${pageId}...`,
          );
          let rawLlmResponseText = "N/A";
          try {
            const llmResponse = await generateChatResponse({
              prompt: refinementPrompt,
              tools: {
                // @ts-expect-error - applyLayoutRefinementTool is not typed
                applyLayoutRefinementTool,
              },
            });
            rawLlmResponseText =
              llmResponse.text || "LLM did not return text for layout.";

            let layoutInstructions: LayoutRefinementToolArgs | undefined;

            if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
              const toolCall = llmResponse.toolCalls[0];
              if (!toolCall) {
                throw new StepError(
                  "LLM tool call structure is invalid.",
                  stepName,
                  rawLlmResponseText,
                );
              }
              if (toolCall.toolName === "applyLayoutRefinementTool") {
                layoutInstructions = toolCall.args as LayoutRefinementToolArgs;

                if (
                  !layoutInstructions ||
                  layoutInstructions.textBoxes === undefined
                ) {
                  throw new StepError(
                    "Parsed layout instructions from tool call are incomplete or malformed.",
                    stepName,
                    JSON.stringify(toolCall.args),
                  );
                }
              } else {
                throw new StepError(
                  `LLM called an unexpected tool: ${toolCall.toolName}. Expected 'applyLayoutRefinementTool'.`,
                  stepName,
                  rawLlmResponseText,
                );
              }
            } else {
              throw new StepError(
                `LLM did not make a tool call for layout refinement. Response: ${rawLlmResponseText.substring(0, 500)}`,
                stepName,
                rawLlmResponseText,
              );
            }

            if (layoutInstructions.textBoxes) {
              for (const tbInstruction of layoutInstructions.textBoxes) {
                const targetElement = createdElements.find(
                  (el) =>
                    el.originalBlockIndex === tbInstruction.originalBlockIndex,
                );
                if (targetElement) {
                  const updateRes =
                    // @ts-expect-error - updateBoxPropertiesOnSlidePage is not typed
                    await runtimeTools.updateBoxPropertiesOnSlidePage.execute({
                      deckNodeKey: currentDeckNodeKey,
                      slideId: pageId,
                      boxId: targetElement.boxId,
                      properties: {
                        x: tbInstruction.x,
                        y: tbInstruction.y,
                        width: tbInstruction.width,
                        height: tbInstruction.height,
                        ...(tbInstruction.textAlign && {
                          textAlign: tbInstruction.textAlign,
                        }),
                      },
                    });
                  if (!updateRes.success) {
                    layoutErrors++;
                    console.error(
                      `Failed to apply LLM layout to box ${targetElement.boxId}: ${updateRes.error}`,
                    );
                  }
                } else {
                  layoutErrors++;
                  console.warn(
                    `LLM provided layout for non-existent text block index: ${tbInstruction.originalBlockIndex}`,
                  );
                }
              }
            }

            if (
              layoutInstructions.visualAssetPlacement &&
              visualElementId &&
              visualAssetInfo
            ) {
              const visualPlacement = layoutInstructions.visualAssetPlacement;
              const updateVisRes =
                // @ts-expect-error - updateSlideElementProperties is not typed
                await runtimeTools.updateSlideElementProperties.execute({
                  deckNodeKey: currentDeckNodeKey,
                  slideId: pageId,
                  elementId: visualElementId,
                  kind: visualAssetInfo.assetType as "image" | "chart",
                  properties: {
                    x: visualPlacement.x,
                    y: visualPlacement.y,
                    width: visualPlacement.width,
                    height: visualPlacement.height,
                    ...(typeof visualPlacement.zIndex === "number" && {
                      zIndex: visualPlacement.zIndex,
                    }),
                  },
                });
              if (!updateVisRes.success) {
                layoutErrors++;
                console.error(
                  `Failed to apply LLM layout to visual ${visualElementId}: ${updateVisRes.error}`,
                );
              }
            }
            dispatchLayoutAction(`LLM layout applied to slide ${pageId}.`);
          } catch (llmOrLayoutError) {
            layoutErrors++;
            const errMsg =
              llmOrLayoutError instanceof Error
                ? llmOrLayoutError.message
                : String(llmOrLayoutError);
            console.error(
              `Error during LLM layout refinement for slide ${pageId}: ${errMsg}. Raw Response (if any): ${rawLlmResponseText.substring(0, 500)}`,
            );
            dispatchLayoutAction(
              `Error in LLM layout for slide ${pageId}: ${errMsg.substring(0, 100)}...`,
            );
          }
        } catch (e) {
          layoutErrors++;
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(`Outer error laying out slide ${pageId}: ${errorMsg}`);
          dispatchLayoutAction(
            `Critical error applying layout to slide ${pageId}: ${errorMsg}`,
          );
        }
      }

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 7 Complete: Layout Engine finished applying LLM-refined layouts to ${pageIds.size} slide(s) (with ${layoutErrors} errors).`,
        },
      });
    },
    [
      chatDispatch,
      runtimeTools.addBoxToSlidePage,
      runtimeTools.updateBoxPropertiesOnSlidePage,
      runtimeTools.updateSlideElementProperties,
      runtimeTools.applyTextStyle,
      runtimeTools.patchNodeByJSON,
      generateChatResponse,
      editor,
      getSlideBoxKeyedState,
    ],
  );

  const runStep8_ReviewRefine = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      audienceData: AudienceData | null;
      storyboardData: StoryboardData | null;
      slideContents: SlideContentData[] | null;
      themeSettings: WorkflowThemeSettings | null;
      visualAssetsData: VisualAssetData[] | null;
      errorContext?: string;
    }): Promise<{ finalSummary: string }> => {
      const {
        currentDeckNodeKey,
        audienceData,
        storyboardData,
        slideContents,
        themeSettings,
        visualAssetsData,
        errorContext,
      } = args;
      const stepName = "ReviewRefine";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 8: ${stepName}...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      if (errorContext) {
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: `Note: ${stepName} is retrying. Previous error context was: ${errorContext.substring(0, 150)}`,
          },
        });
      }

      try {
        const summaryLines = [
          `Step 8: ${stepName} Complete`,
          `- Deck Node Key: ${currentDeckNodeKey}`,
          `- Audience Big Idea: ${audienceData?.bigIdea || "N/A"}`,
          `- Number of Slides in Storyboard: ${storyboardData?.slides?.length || 0}`,
          `- Number of Slides with Generated Content: ${slideContents?.length || 0}`,
          `- Theme Template: ${themeSettings?.templateName || "N/A"}`,
          `- Visual Assets Processed: ${visualAssetsData?.filter((va) => va.assetType !== "none").length || 0} (out of ${visualAssetsData?.length || 0} visual ideas)`,
        ];

        if (!currentDeckNodeKey) {
          throw new StepError(
            "currentDeckNodeKey is missing for Review & Refine.",
            stepName,
          );
        }

        const finalSummary = summaryLines.join("\\n");

        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "assistant",
            content: finalSummary,
          },
        });

        return { finalSummary };
      } catch (error) {
        if (error instanceof StepError) throw error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new StepError(
          `Error in ${stepName}: ${errorMsg}`,
          stepName,
          "N/A",
        );
      }
    },
    [chatDispatch],
  );

  const startSlideGeneration = useCallback(
    async (params: SlideGenerationParams) => {
      setIsLoading(true);
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: "Slide generation workflow initiated...",
        },
      });

      workflowRetryBudgetRef.current = MAX_WORKFLOW_RETRIES;
      let resolvedDeckNodeKey: string | null = deckNodeKey;
      let currentAudienceData: AudienceData | null = null;
      let currentResearchData: ResearchData | null = null;
      let currentStoryboardData: StoryboardData | null = null;
      let currentSlideContents: SlideContentData[] | null = null;
      let currentThemeSettings: WorkflowThemeSettings | null = null;
      let currentVisualAssetsData: VisualAssetData[] | null = null;

      try {
        const currentDocumentMarkdown = params.attachCurrentDocument
          ? convertEditorStateToMarkdown(editor.getEditorState())
          : undefined;

        if (params.existingDeckNodeKey) {
          resolvedDeckNodeKey = params.existingDeckNodeKey;
          setDeckNodeKey(resolvedDeckNodeKey);
        } else if (!resolvedDeckNodeKey) {
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: "Creating new slide deck...",
            },
          });
          if (!runtimeTools.insertSlideDeckNode) {
            throw new Error("insertSlideDeckNode tool is not available.");
          }
          const deckCreationResult =
            // @ts-expect-error - insertSlideDeckNode is not typed
            await runtimeTools.insertSlideDeckNode.execute({
              relation: "appendRoot",
            });

          if (
            deckCreationResult.success &&
            deckCreationResult.content?.newNodeKey
          ) {
            resolvedDeckNodeKey = deckCreationResult.content.newNodeKey;
            setDeckNodeKey(resolvedDeckNodeKey);
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `New slide deck created with key: ${resolvedDeckNodeKey}`,
              },
            });
          } else {
            throw new Error(
              `Failed to create new slide deck: ${deckCreationResult.error || "Unknown error"}`,
            );
          }
        }

        if (!resolvedDeckNodeKey) {
          throw new Error(
            "Slide deck node key could not be resolved or created.",
          );
        }

        currentAudienceData = await executeStepWithRetries(
          runStep1_AudiencePlanner,
          "AudiencePlanner",
          {
            topic: params.topic,
            who: params.who,
            outcome: params.outcome,
            timebox: params.timebox,
            currentDocumentMarkdown,
          },
        );
        setAudienceData(currentAudienceData);

        const deckMetadataForStep1: DeckStrategicMetadata = {
          bigIdea: currentAudienceData.bigIdea,
          audiencePersonaSummary: currentAudienceData.persona,
          targetSlideCount:
            MAX_SLIDES_COUNT !== undefined
              ? MAX_SLIDES_COUNT
              : currentAudienceData.slideCount,
          recommendedTone: currentAudienceData.tone,
          originalUserPrompt: `Topic: ${params.topic}, Audience: ${params.who}, Outcome: ${params.outcome}, Timebox: ${params.timebox},`,
        };

        if (!runtimeTools.setDeckMetadata) {
          throw new Error("setDeckMetadata tool is not available.");
        }
        // @ts-expect-error - setDeckMetadata is not typed
        await runtimeTools.setDeckMetadata.execute({
          deckNodeKey: resolvedDeckNodeKey,
          deckMetadata: deckMetadataForStep1,
        });

        currentThemeSettings = await executeStepWithRetries(
          runStep2_StyleStylist,
          "StyleStylist",
          {
            currentDeckNodeKey: resolvedDeckNodeKey,
            currentAudienceData: currentAudienceData,
          },
        );
        setThemeSettings(currentThemeSettings);

        currentResearchData = await executeStepWithRetries(
          runStep3_ResearchAgent,
          "ResearchAgent",
          {
            audienceDataParam: currentAudienceData,
            files: params.files,
            currentDocumentMarkdown,
          },
        );
        setResearchData(currentResearchData);

        const storyboardSlideCount =
          MAX_SLIDES_COUNT !== undefined
            ? MAX_SLIDES_COUNT
            : currentAudienceData.slideCount;

        currentStoryboardData = await executeStepWithRetries(
          runStep4_StoryboardArchitect,
          "StoryboardArchitect",
          {
            researchDataParam: currentResearchData,
            slideCount: storyboardSlideCount,
            resolvedDeckKeyForThisStep: resolvedDeckNodeKey,
          },
        );
        setStoryboardData(currentStoryboardData);

        currentSlideContents = await executeStepWithRetries(
          runStep5_SlideWriter,
          "SlideWriter",
          {
            storyboardDataParam: currentStoryboardData,
            currentDeckNodeKey: resolvedDeckNodeKey,
          },
        );
        setSlideContents(currentSlideContents);

        if (
          currentStoryboardData &&
          resolvedDeckNodeKey &&
          currentThemeSettings
        ) {
          currentVisualAssetsData = await executeStepWithRetries(
            runStep6_MediaGenerator,
            "MediaGenerator",
            {
              storyboardDataParam: currentStoryboardData,
              currentDeckNodeKey: resolvedDeckNodeKey,
              currentThemeSettings: currentThemeSettings,
            },
          );
          setVisualAssetsData(currentVisualAssetsData);
        } else {
          const missingDepsError =
            "Cannot run MediaGenerator due to missing storyboard data, deck key, or theme settings.";
          console.error(missingDepsError, {
            currentStoryboardData,
            resolvedDeckNodeKey,
            currentThemeSettings,
          });
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Skipping MediaGenerator: ${missingDepsError}`,
            },
          });
        }

        await executeStepWithRetries(runStep7_LayoutEngine, "LayoutEngine", {
          currentDeckNodeKey: resolvedDeckNodeKey,
          storyboardDataParam: currentStoryboardData,
          allSlideContents: currentSlideContents,
          allVisualAssets: currentVisualAssetsData,
          currentThemeSettings: currentThemeSettings,
        });

        const step8Result = await executeStepWithRetries(
          runStep8_ReviewRefine,
          "ReviewRefine",
          {
            currentDeckNodeKey: resolvedDeckNodeKey,
            audienceData: currentAudienceData,
            storyboardData: currentStoryboardData,
            slideContents: currentSlideContents,
            themeSettings: currentThemeSettings,
            visualAssetsData: currentVisualAssetsData,
          },
        );

        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: `Slide generation workflow steps concluded. Final summary from Review & Refine: ${step8Result.finalSummary}`,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Slide generation workflow failed:", error);
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content:
              error instanceof StepError
                ? `Workflow error during ${error.stepName}: ${errorMsg}`
                : `Workflow error: ${errorMsg}`,
          },
        });
      } finally {
        setIsLoading(false);
      }
    },
    [
      deckNodeKey,
      editor,
      runtimeTools.setDeckMetadata,
      runtimeTools.insertSlideDeckNode,
      chatDispatch,
      convertEditorStateToMarkdown,
      executeStepWithRetries,
      runStep1_AudiencePlanner,
      runStep2_StyleStylist,
      runStep3_ResearchAgent,
      runStep4_StoryboardArchitect,
      runStep5_SlideWriter,
      runStep6_MediaGenerator,
      runStep7_LayoutEngine,
      runStep8_ReviewRefine,
    ],
  );

  return {
    startSlideGeneration,
    isLoading,
    audienceData,
    researchData,
    storyboardData,
    deckNodeKey,
    slideContents,
    themeSettings,
    visualAssetsData,
  };
}
