import { useState, useCallback, useRef } from "react";
import { RuntimeToolMap, useLLM } from "../../context/llm-context";
import { useChatDispatch } from "./llm-chat-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import {
  type DeckStrategicMetadata,
  type SlideStrategicMetadata,
} from "../../nodes/SlideNode/SlideNode";
import { NodeKey } from "lexical";
import { getSlideBoxKeyedState } from "../../context/editors-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

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
  keyMessage: string; // markdown bullets ok
  visualIdea: string;
  speakerNotes: string;
  pageId?: string; // pageid set after creation
  styleHint?: string;
}

interface StoryboardData {
  slides: SlideOutline[]; // pageid added later
}

// data structure for slide writer content
interface SlideContentData {
  pageId: string; // slide page ref
  structuredBodyContent: { type: string; text: string }[];
  refinedSpeakerNotes: string;
}

interface SlideGenerationParams {
  topic: string;
  who: string;
  outcome: string;
  timebox: string;
  files?: File[]; // optional research files
  existingDeckNodeKey?: string;
}

// theme settings, mirrors slidenode.themesettings
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
  customTokens?: string; // string, maybe json
}

// media/visuals from mediagenerator (step 6)
interface VisualAssetData {
  pageId: string;
  assetType: "image" | "chart" | "none"; // "none" if visual idea not actionable/error
  visualIdea: string; // original visual idea
  imagePrompt?: string; // for images
  imageUrl?: string; // placeholder, url later
  imageId?: string; // image node key if created
  chartId?: string; // chart nodekey
  chartType?: string; // e.g. bar, line, pie
  styleHint?: string;
  error?: string; // asset-specific error
}

// for addcharttoslidepage tool results
interface ToolExecutionResultForMedia {
  success: boolean;
  content?: {
    summary: string;
    newNodeKey?: string; // crucial for identifying the new node
    updatedEditorStateJson?: string;
  };
  error?: string;
}

// custom error for step failures
class StepError extends Error {
  public rawResponseText?: string;
  public stepName: string;

  constructor(message: string, stepName: string, rawResponseText?: string) {
    super(message);
    this.name = "StepError";
    this.stepName = stepName;
    this.rawResponseText = rawResponseText;
    // Set the prototype explicitly.
    Object.setPrototypeOf(this, StepError.prototype);
  }
}

const MAX_WORKFLOW_RETRIES = 3;
const MAX_SLIDES_COUNT: number | undefined = 2; // for testing, e.g., 2

export function useSlideCreationWorkflow() {
  const [editor] = useLexicalComposerContext();
  const { generateChatResponse } = useLLM();
  const chatDispatch = useChatDispatch();
  const runtimeTools = useRuntimeTools();

  // global retry budget for workflow
  const workflowRetryBudgetRef = useRef(MAX_WORKFLOW_RETRIES);

  // workflow data states
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
    useState<WorkflowThemeSettings | null>(null); // step 5 output
  const [visualAssetsData, setVisualAssetsData] = useState<
    VisualAssetData[] | null
  >(null); // step 6 output
  const [isLoading, setIsLoading] = useState(false);

  const executeStepWithRetries = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async <T extends (...args: any[]) => Promise<any>>(
      stepFunction: T,
      stepName: string,
      ...args: Parameters<T>
    ): Promise<Awaited<ReturnType<T>>> => {
      let lastError: StepError | Error | null = null;
      let errorContext: string | undefined = undefined;

      // The last argument to a step function can be the errorContext
      const potentialErrorContextArgIndex = args.length - 1;

      while (workflowRetryBudgetRef.current > 0) {
        try {
          // If errorContext is available, pass it as the last argument
          // This assumes step functions are designed to accept an optional errorContext string as their last param
          const stepArgs = [...args];
          if (
            errorContext &&
            stepArgs[potentialErrorContextArgIndex] === undefined
          ) {
            stepArgs[potentialErrorContextArgIndex] = errorContext;
          } else if (
            errorContext &&
            typeof stepArgs[potentialErrorContextArgIndex] === "object" &&
            stepArgs[potentialErrorContextArgIndex] !== null
          ) {
            // If the last arg is an object (e.g. options), try to add errorContext to it
            // This is a more flexible approach but relies on step functions checking for this.
            // For now, we'll stick to the simpler approach of replacing if undefined.
            // A more robust solution might involve a dedicated options object for all steps.
          }

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Executing step: ${stepName}${errorContext ? ` (with error context from previous attempt)` : ""}. Retries remaining: ${workflowRetryBudgetRef.current}`,
            },
          });

          const result = await stepFunction(...(stepArgs as Parameters<T>));
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
            errorContext = `Previous attempt for ${stepName} failed with error: ${error.message}. The raw response was: "${error.rawResponseText}". Please analyze this and try a different approach.`;
          } else if (error instanceof Error) {
            errorContext = `Previous attempt for ${stepName} failed with error: ${error.message}. Please try a different approach.`;
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
            throw lastError; // Rethrow the last error if no retries are left
          }
          // Implicitly continues to the next iteration of the while loop for a retry
        }
      }
      // This part should ideally not be reached if the loop correctly throws or returns.
      // If it is reached, it means retries were exhausted and the lastError should be thrown.
      if (lastError) throw lastError;
      // Fallback throw, though logic implies this is unreachable.
      throw new Error(
        `Step ${stepName} failed critically after exhausting retries.`,
      );
    },
    [chatDispatch], // generateChatResponse removed as it's not directly used here
  );

  const runStep1_AudiencePlanner = useCallback(
    async (
      topic: string,
      who: string,
      outcome: string,
      timebox: string,
      errorContext?: string, // added errorcontext parameter
    ): Promise<AudienceData> => {
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
${errorContext ? `\nImportant Context from Previous Attempt:\n${errorContext}\n` : ""}
▶︎ Provide your response as a JSON object with the keys "bigIdea", "persona", "slideCount" (number), and "tone". Example: {"bigIdea": "Your concise big idea", "persona": "Summary of the audience persona", "slideCount": 10, "tone": "Professional and engaging"}`;

      let rawResponseText = "N/A";
      try {
        const response = await generateChatResponse({
          prompt,
        });

        if (!response.text) {
          rawResponseText = "LLM did not return text.";
          throw new StepError(rawResponseText, stepName, rawResponseText);
        }
        rawResponseText = response.text;

        const cleanedJsonText = response.text
          .replace(/^\s*```json\n?|\n?```\s*$/g, "")
          .trim();

        let parsedData: AudienceData;
        try {
          parsedData = JSON.parse(cleanedJsonText) as AudienceData;
        } catch (jsonError) {
          const parseErrorMsg =
            jsonError instanceof Error ? jsonError.message : String(jsonError);
          throw new StepError(
            `Failed to parse JSON output from ${stepName}: ${parseErrorMsg}`,
            stepName,
            rawResponseText,
          );
        }

        if (
          !parsedData.bigIdea ||
          !parsedData.persona ||
          typeof parsedData.slideCount !== "number" ||
          !parsedData.tone
        ) {
          throw new StepError(
            `${stepName} output is missing required fields or has incorrect types.`,
            stepName,
            rawResponseText,
          );
        }

        setAudienceData(parsedData);
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Step 1 Complete: Audience Plan
Big Idea: ${parsedData.bigIdea}
Persona: ${parsedData.persona}
Slide Count: ${parsedData.slideCount}
Tone: ${parsedData.tone}`,
          },
        });
        return parsedData;
      } catch (error) {
        // If it's already a StepError, rethrow it to be caught by executeStepWithRetries
        if (error instanceof StepError) throw error;

        // Otherwise, wrap it in a StepError
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
    async (
      currentDeckNodeKey: string,
      currentAudienceData: AudienceData | null,
      errorContext?: string,
    ): Promise<WorkflowThemeSettings> => {
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
        // This is a setup error, not an LLM/retryable error usually.
        throw new Error(
          "Required tools (saveThemeStyleSuggestions, setDeckMetadata) are not available for Style Stylist.",
        );
      }

      const userObjectiveInfo = currentAudienceData
        ? `The presentation's big idea is: "${currentAudienceData.bigIdea}". It is for persona: "${currentAudienceData.persona}" and should have a "${currentAudienceData.tone}" tone.`
        : "The presentation context is not fully defined.";

      const prompt = `You are an expert Brand & Style Specialist.
${userObjectiveInfo}
${errorContext ? `\nImportant Context from Previous Attempt:\n${errorContext}\n` : ""}
Suggest a comprehensive visual theme for this presentation. Your suggestions should include:
1.  A "templateName" or general style description (e.g., 'Modern Minimalist', 'Tech Professional', 'Vibrant Startup').
2.  A "colorPalette" with hex codes for: 'primary', 'secondary', 'accent', 'slideBackground', 'textHeader', 'textBody'.
3.  "fonts" with font family names for: 'heading', 'body', 'caption'.
4.  Optionally, a "logoUrl" if you think a placeholder logo would be appropriate (use a generic placeholder URL if so).
5.  Optionally, any "customTokens" as a JSON string for further theme refinements (e.g., specific border styles, shadow effects). Example: '{"cardBorderRadius": "8px"}'.

Your response MUST be a call to the "saveThemeStyleSuggestions" tool, providing these details as arguments. Ensure all color codes are valid hex (e.g., #RRGGBB).`;
      let rawResponseText = "N/A"; // For error reporting

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
          response.toolCalls.length > 0 &&
          response.toolCalls[0]?.toolName === "saveThemeStyleSuggestions"
        ) {
          const suggestedTheme = response.toolCalls[0]
            .args as WorkflowThemeSettings;

          setThemeSettings(suggestedTheme); // UI update

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Updating deck metadata with new theme settings for deck: ${currentDeckNodeKey}...`,
            },
          });

          // @ts-expect-error - tool parameters are typed as `any` for execute
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
            // This might be considered a non-fatal warning for the step itself,
            // but it is important. For now, we let the step succeed but log a warning.
            // Depending on strictness, one might throw new StepError here.
          }

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Step 2 Complete: Style Stylist suggested theme: ${suggestedTheme.templateName || "Custom Theme"}. Color Palette: ${JSON.stringify(suggestedTheme.colorPalette)}. Fonts: ${JSON.stringify(suggestedTheme.fonts)}. Deck metadata updated.`,
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
    async (
      audienceDataParam: AudienceData,
      files?: File[],
      errorContext?: string,
    ): Promise<ResearchData> => {
      const stepName = "ResearchAgent";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 3: ${stepName}...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });
      const scope = `Based on the Big Idea: '${audienceDataParam.bigIdea}' and audience persona: '${audienceDataParam.persona}', what information is needed?`;
      const prompt = `You are the *Research Agent*.
Inputs: ${files?.map((f) => f.name).join(", ") ?? "None"}
Scope: ${scope}
Constraints: Cite every datum with source + date.
${errorContext ? `\nImportant Context from Previous Attempt:\n${errorContext}\n` : ""}
▶︎ Return bullet-point findings, sorted by slide section. If using tools, summarize their output clearly.`;
      let rawResponseText = "N/A";

      try {
        const response = await generateChatResponse({
          prompt,
          files, // Pass files if provided
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
    async (
      researchDataParam: ResearchData,
      slideCount: number,
      resolvedDeckKeyForThisStep: string,
      errorContext?: string,
    ): Promise<StoryboardData> => {
      const stepName = "StoryboardArchitect";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 4: ${stepName} (target: ${slideCount} slides) for deck ${resolvedDeckKeyForThisStep}.${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      const prompt = `You are the *Storyboard Architect*.
Based on the following research findings:
---
${researchDataParam.findings}
---
Create a storyboard for a presentation with approximately ${slideCount} slides.
For each slide, you must define:
1. slideNumber: (integer, starting from 1)
2. title: (string, concise and engaging)
3. keyMessage: (string, bullet points summarizing the core message for this slide, can use markdown)
4. visualIdea: (string, a brief textual description of a potential visual or chart for this slide)
5. speakerNotes: (string, brief notes for the presenter)
${errorContext ? `\nImportant Context from Previous Attempt:\n${errorContext}\n` : ""}
▶︎ Generate the storyboard as a JSON array of slide objects. Provide this array *only* through the "slides" argument of the "saveStoryboardOutput" tool.
The "slides" argument MUST be a valid JSON array where each object has "slideNumber", "title", "keyMessage", "visualIdea", and "speakerNotes".
Example for the "slides" argument:
[
  { "slideNumber": 1, "title": "Slide 1 Title", "keyMessage": "* Point 1\\n* Point 2", "visualIdea": "Idea 1", "speakerNotes": "Notes 1" },
  { "slideNumber": 2, "title": "Slide 2 Title", "keyMessage": "Message for slide 2.", "visualIdea": "Idea 2", "speakerNotes": "Notes 2" }
]
Your entire response must be *only* this single tool call. Do not include any other text, explanations, or summaries in your response.
`;
      let rawResponseText = "N/A";

      if (!runtimeTools.saveStoryboardOutput) {
        // Setup error
        throw new Error(
          "saveStoryboardOutput tool is not available for StoryboardArchitect.",
        );
      }
      if (!runtimeTools.addSlidePage) {
        // Setup error
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
                JSON.stringify(toolCall.args), // Use args as raw response here
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
              };
              // @ts-expect-error - tool parameters are typed as `any` for execute
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
                // This specific error is for a sub-operation. We log it but don't fail the whole step for one slide page creation failure.
                // The summary at the end will indicate errors.
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
              // Potentially, if ALL slide creations fail, one might throw a StepError.
              // For now, partial success is allowed.
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
    async (
      storyboardDataParam: StoryboardData,
      currentDeckNodeKey: string,
      errorContext?: string,
    ): Promise<SlideContentData[]> => {
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
      let contentGenerationErrors = 0; // Tracks errors for individual slides within this step
      let individualSlideErrorContext = errorContext; // Start with overall step error context if any

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
[{"type": "heading2", "text": "Key Achievements"}, {"type": "bulletList", "text": "Launched Product X\nReached 1M Users\nSecured Series A Funding"}]

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
            const args = response.toolCalls[0].args as {
              pageId: string;
              bodyContent: { type: string; text: string }[];
              refinedSpeakerNotes: string;
            };

            const metadataUpdateResult =
              // @ts-expect-error - tool parameters are typed as `any` for execute
              await runtimeTools.setSlideMetadata.execute({
                deckNodeKey: currentDeckNodeKey,
                slideId: args.pageId,
                slideMetadata: {
                  structuredBodyContent: JSON.stringify(args.bodyContent),
                  speakerNotes: args.refinedSpeakerNotes,
                },
              });

            if (!metadataUpdateResult.success) {
              console.warn(
                `Failed to set metadata (structuredBodyContent, speakerNotes) for slide ${args.pageId}: ${metadataUpdateResult.error}`,
              );
            }

            generatedContents.push({
              pageId: args.pageId,
              structuredBodyContent: args.bodyContent,
              refinedSpeakerNotes: args.refinedSpeakerNotes,
            });

            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Structured content and notes saved for slide ${slideOutline.slideNumber} (pageId: ${args.pageId}).`,
              },
            });
            individualSlideErrorContext = undefined; // Clear error for this slide on success
          } else {
            contentGenerationErrors++;
            const toolErrorMsg = `Expected tool call 'saveSlideContentAndNotes' for slide ${slideOutline.pageId}, but received different or no tool call.`;
            // This error is specific to one slide generation. We log it, increment error count, and prepare context for a potential retry of the *whole step*.
            console.error(toolErrorMsg, "Raw LLM Response:", rawResponseText);
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content: `${toolErrorMsg} LLM raw response: ${rawResponseText.substring(0, 150)}...`,
              },
            });
            // For a retry of the whole step, we might want to aggregate these errors.
            // For now, the next retry of runStep5_SlideWriter will get the original errorContext if the step fails overall.
            // We don't throw StepError here to allow other slides to be processed.
            // Instead, we check contentGenerationErrors at the end of the loop.
            individualSlideErrorContext = `Failed on slide ${slideOutline.slideNumber} (${slideOutline.title}): ${toolErrorMsg}. Raw LLM Response: ${rawResponseText.substring(0, 150)}`;
            // This specific slide context is now set for the next iteration if the LLM prompt uses it.
            // However, executeStepWithRetries retries the *entire* step function.
            // So, a single slide failure here will cause the whole step to retry if this is the first error.
            // To make this more granular for retry (retry only failed slides), would require more complex state management for this step.
            // Given the current retry mechanism, we should throw a StepError here to trigger a retry of the whole step.
            throw new StepError(
              toolErrorMsg,
              `${stepName} - Slide ${slideOutline.slideNumber}`,
              rawResponseText,
            );
          }
        } catch (e) {
          // If it's already a StepError (like the one thrown above), rethrow.
          if (e instanceof StepError) throw e;

          // Otherwise, it's an unexpected error during this slide's processing.
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
          // This error will propagate to executeStepWithRetries and cause the whole step to retry if budget allows.
          throw new StepError(
            detailedErrorMsg,
            `${stepName} - Slide ${slideOutline.slideNumber}`,
            rawResponseText,
          );
        }
      }

      // This check might be redundant if individual slide errors always throw and cause step retry.
      if (contentGenerationErrors > 0 && generatedContents.length === 0) {
        // If all slides failed within this step, it's a definite failure for the step.
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

      setSlideContents(generatedContents); // UI update
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
    async (
      storyboardDataParam: StoryboardData,
      currentDeckNodeKey: string,
      currentThemeSettings: WorkflowThemeSettings | null,
      errorContext?: string,
    ): Promise<VisualAssetData[]> => {
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
      let assetGenerationErrors = 0; // Tracks errors for individual assets within this step
      let individualAssetErrorContext = errorContext; // Start with overall step error context if any

      if (
        !runtimeTools.saveImageGenerationRequest ||
        !runtimeTools.addChartToSlidePage
      ) {
        throw new Error(
          "Required tools (saveImageGenerationRequest, addChartToSlidePage) are not available for Media Generator.",
        );
      }

      const themeStyleHint = currentThemeSettings?.templateName
        ? ` The overall presentation style is '${currentThemeSettings.templateName}'.`
        : "";
      const themeColorsHint = currentThemeSettings?.colorPalette
        ? ` Key theme colors are: ${JSON.stringify(currentThemeSettings.colorPalette)}.`
        : "";

      for (const slideOutline of storyboardDataParam.slides) {
        let rawResponseText = "N/A"; // For error reporting for this specific asset
        if (!slideOutline.pageId) {
          console.warn(
            `Skipping media generation for slide ${slideOutline.slideNumber} ('${slideOutline.title}') in ${stepName} as it has no pageId.`,
          );
          generatedAssets.push({
            pageId: "unknown", // Or slideOutline.slideNumber.toString() if pageId is truly missing
            visualIdea: slideOutline.visualIdea,
            assetType: "none",
            error: "Missing pageId",
          });
          assetGenerationErrors++; // Count this as an error/skip for the summary
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
${individualAssetErrorContext ? `\nImportant Context from Previous Attempt for this visual (or step):\n${individualAssetErrorContext}\n` : ""}
Based on this, decide if an image or a chart is most appropriate. 

~1.  If an IMAGE is best:~
    ~*   Craft a concise, descriptive prompt for an image generation model (like DALL-E). The prompt should incorporate the visual idea and relevant style hints.~
    ~*   Call the "saveImageGenerationRequest" tool with arguments: "pageId" (use "${slideOutline.pageId}"), "imagePrompt" (your crafted prompt), and "styleHint" (e.g., derived from theme like '${currentThemeSettings?.templateName || "general"}').~

2.  If a CHART (bar, line, pie, etc.) is best:
    *   Determine the "chartType".
    *   Synthesize plausible "chartDataJSON" based on the visual idea. This should be a JSON string representing an array of data objects suitable for the chart type (e.g., for a bar chart: '[{"name": "A", "value": 10}, ...]'). Keep data simple (3-5 data points) unless specified otherwise.
    *   Suggest a simple "chartConfigJSON" if applicable (e.g., for Recharts, defining colors or labels as a JSON string: '{"value": {"label": "Sales", "color": "${currentThemeSettings?.colorPalette?.accent || "#8884d8"}"}}'). Often an empty object string '{}' is fine.
    *   Call the "addChartToSlidePage" tool with arguments: "deckNodeKey" (use "${currentDeckNodeKey}"), "slideId" (use "${slideOutline.pageId}"), "chartType", "chartDataJSON", "chartConfigJSON". You can also specify "x", "y", "width", "height" (e.g. x:100, y:200, width:500, height:300) or let the layout engine handle it later. For now, use x:100, y:200, width:500, height:300 if you call this tool.

Choose only ONE tool to call: either ~"saveImageGenerationRequest"~ OR "addChartToSlidePage". 
For now, the "saveImageGenerationRequest" tool is disabled.`;

        try {
          const response = await generateChatResponse({
            prompt,
            tools: {
              saveImageGenerationRequest:
                runtimeTools.saveImageGenerationRequest, // Still provide, even if prompt says disabled, for robustness
              addChartToSlidePage: runtimeTools.addChartToSlidePage,
            } as RuntimeToolMap,
          });
          rawResponseText =
            response.text || "No text from LLM for media decision.";

          if (response.toolCalls && response.toolCalls.length > 0) {
            const toolCall = response.toolCalls[0];
            if (toolCall?.toolName === "saveImageGenerationRequest") {
              const args = toolCall.args as {
                pageId: string;
                imagePrompt: string;
                styleHint?: string;
              };
              generatedAssets.push({
                pageId: args.pageId,
                assetType: "image",
                visualIdea: slideOutline.visualIdea,
                imagePrompt: args.imagePrompt,
                styleHint: args.styleHint,
              });
              chatDispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: `Slide ${slideOutline.slideNumber} (Page ID: ${args.pageId}): Image generation requested. Prompt: "${args.imagePrompt.substring(0, 100)}..."`,
                },
              });
              individualAssetErrorContext = undefined; // Clear error for this asset
            } else if (toolCall?.toolName === "addChartToSlidePage") {
              const args = toolCall.args as {
                deckNodeKey: string;
                slideId: string;
                chartType: string;
                chartDataJSON: string;
                chartConfigJSON: string;
              };

              let actualChartId: string | undefined = undefined;
              let assetErrorMsg: string | undefined = undefined;

              if (
                response.toolResults &&
                response.toolResults.length === 1 &&
                response.toolResults[0]?.toolName === "addChartToSlidePage"
              ) {
                const toolResult = response.toolResults[0];
                const typedToolExecuteResult =
                  toolResult.result as ToolExecutionResultForMedia;

                if (
                  typedToolExecuteResult.success &&
                  typedToolExecuteResult.content?.newNodeKey
                ) {
                  actualChartId = typedToolExecuteResult.content.newNodeKey;
                } else {
                  assetErrorMsg = `addChartToSlidePage for slide ${args.slideId} did not succeed or return a newNodeKey. Result: ${JSON.stringify(toolResult.result)}`;
                  console.warn(assetErrorMsg);
                }
              } else {
                assetErrorMsg = `Expected one toolResult for addChartToSlidePage on slide ${args.slideId}, but found ${response.toolResults?.length || 0}. Tool Results: ${JSON.stringify(response.toolResults)}`;
                console.warn(assetErrorMsg);
              }

              if (!actualChartId) {
                actualChartId = `chart-on-${args.slideId}-FALLBACK-${Date.now()}`;
                if (!assetErrorMsg) {
                  assetErrorMsg = `Failed to retrieve a valid newNodeKey for chart on slide ${args.slideId}. Using fallback ID.`;
                }
                // This situation indicates a problem. We should throw an error to retry the step.
                throw new StepError(
                  assetErrorMsg,
                  `${stepName} - Chart Creation on Slide ${slideOutline.slideNumber}`,
                  JSON.stringify(response.toolResults),
                );
              }

              generatedAssets.push({
                pageId: args.slideId,
                assetType: "chart",
                visualIdea: slideOutline.visualIdea,
                chartId: actualChartId,
                chartType: args.chartType,
                styleHint: slideOutline.styleHint,
                error: assetErrorMsg, // Log any non-fatal error with the asset data
              });
              individualAssetErrorContext = undefined; // Clear error for this asset
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
                content: `${noToolCallError} Content: ${rawResponseText}`,
              },
            });
            generatedAssets.push({
              pageId: slideOutline.pageId,
              assetType: "none",
              visualIdea: slideOutline.visualIdea,
              error: "LLM did not call a media tool. " + rawResponseText,
            });
            // This might be a valid case if the visual idea is not actionable.
            // However, if we expect a tool call for every valid visual idea, this could be an error for retry.
            // For now, let's consider it a soft error and not throw a StepError, allowing the step to proceed.
            // If this should fail the step, a StepError should be thrown.
            individualAssetErrorContext = `${noToolCallError}. Raw Response: ${rawResponseText.substring(0, 150)}`;
            // If this is a critical failure for the slide, throw to retry step:
            // throw new StepError(noToolCallError, `${stepName} - Slide ${slideOutline.slideNumber}`, rawResponseText);
          }
        } catch (e) {
          if (e instanceof StepError) throw e; // Rethrow if already a StepError

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

      // If a significant number of assets failed, or if all assets that were attempted failed,
      // it might be grounds to fail the entire step.
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

      setVisualAssetsData(generatedAssets); // UI Update
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
    [chatDispatch, generateChatResponse, runtimeTools],
  );

  const runStep7_LayoutEngine = useCallback(
    async (
      currentDeckNodeKey: string,
      allSlideContents: SlideContentData[] | null,
      allVisualAssets: VisualAssetData[] | null,
      currentThemeSettings: WorkflowThemeSettings | null,
      errorContext?: string,
    ): Promise<void> => {
      const stepName = "LayoutEngine";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 7: ${stepName} - Processing structured content and visuals...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      if (
        !runtimeTools.addBoxToSlidePage ||
        !runtimeTools.updateBoxPropertiesOnSlidePage ||
        !runtimeTools.updateSlideElementProperties ||
        !runtimeTools.applyTextStyle ||
        !runtimeTools.patchNodeByJSON
      ) {
        throw new Error("Required tools for LayoutEngine are not available.");
      }

      // This step typically doesn't involve direct LLM calls that would benefit from errorContext in a prompt.
      // Retries for this step would re-run the logic. If errors are due to inconsistent prior step data,
      // those prior steps should be made more robust.
      // If an error occurs here, it's likely a logic or tool execution error.
      // The `executeStepWithRetries` will still retry it if workflowRetryBudgetRef allows.
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
      const GAP = 20;

      const pageIds = new Set<string>();
      if (allSlideContents)
        allSlideContents.forEach((sc) => pageIds.add(sc.pageId));
      if (allVisualAssets)
        allVisualAssets.forEach((va) => va.pageId && pageIds.add(va.pageId));

      let layoutErrors = 0;

      for (const pageId of pageIds) {
        const slideContentInfo = allSlideContents?.find(
          (sc) => sc.pageId === pageId,
        );
        const visualAssetInfo = allVisualAssets?.find(
          (va) =>
            va.pageId === pageId &&
            (va.assetType === "chart" || va.assetType === "image"),
        );

        try {
          const createdContentBoxKeys: string[] = [];
          let parsedContentBlocks: { type: string; text: string }[] = [];

          if (slideContentInfo?.structuredBodyContent) {
            // No longer need to parse, it's already an array of objects
            parsedContentBlocks = slideContentInfo.structuredBodyContent;
            if (!Array.isArray(parsedContentBlocks)) {
              layoutErrors++;
              console.error(
                `Internal error: structuredBodyContent for slide ${pageId} is not an array. Found: ${typeof parsedContentBlocks}`,
              );
              chatDispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "system",
                  content: `Internal error with structured content for slide ${pageId}. Skipping content layout for this slide.`,
                },
              });
              parsedContentBlocks = []; // Reset to empty array to prevent further issues
            }
          }

          let currentY = PADDING;
          const availableWidth = SLIDE_WIDTH - 2 * PADDING;

          const visualElementId =
            visualAssetInfo?.assetType === "chart"
              ? visualAssetInfo.chartId
              : visualAssetInfo?.imageId;
          const visualPresent = visualAssetInfo && visualElementId;

          for (const block of parsedContentBlocks) {
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

            // 1. Add the box (it will have empty content by default from emptyContent())
            // initialTextContent passed here is currently ignored by addBoxToSlidePage's Zod schema.
            // The box is created using the static `emptyContent`.
            // @ts-expect-error - If initialTextContent is not part of the tool's schema, this arg is unused by the tool
            const boxResult = await runtimeTools.addBoxToSlidePage.execute({
              deckNodeKey: currentDeckNodeKey,
              slideId: pageId,
              // initialTextContent: block.text, // This was passed but not used by addBoxToSlidePage tool
              x: PADDING, // Default position/size, will be updated later by layout logic below
              y: PADDING, // Default y, will be updated by positioning logic below
              width: SLIDE_WIDTH - 2 * PADDING, // Default width
              height: 100, // Default height
            });

            if (boxResult.success && boxResult.content?.newNodeKey) {
              const newBoxId = boxResult.content.newNodeKey;
              const textNodeOriginalKeyFromEmptyContent = (
                boxResult.content as unknown as { textNodeKey?: string }
              )?.textNodeKey; // This is "initial-text-content-node"

              if (
                textNodeOriginalKeyFromEmptyContent &&
                block.text.trim() !== ""
              ) {
                const fullEditorKeyForBox = `${currentDeckNodeKey}/${pageId}/${newBoxId}`;
                createdContentBoxKeys.push(newBoxId);

                const patchResult =
                  // @ts-expect-error - Tool parameters might be typed as `any`
                  await runtimeTools.patchNodeByJSON.execute({
                    editorKey: fullEditorKeyForBox,
                    nodeKey: textNodeOriginalKeyFromEmptyContent, // Target the default text node
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
                      console.error(
                        `[LayoutEngine] Could not find the key of the persisted text node for box ${newBoxId} after patch. Using original key as fallback for styling.`,
                      );
                      actualTextNodeKeyForStyling =
                        textNodeOriginalKeyFromEmptyContent; // Fallback, might be incorrect
                      // layoutErrors++; // Optionally count as error if strict keying is required
                      // continue; // Skip styling for this block if key is essential and not found
                    }
                  } else {
                    console.error(
                      "[LayoutEngine] mainEditor instance not available. Cannot determine new text node key for styling. Using original key as fallback.",
                    );
                    actualTextNodeKeyForStyling =
                      textNodeOriginalKeyFromEmptyContent; // Fallback
                  }
                  // ---- End NEW key determination ----

                  // 3. Apply text style
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
                    case "paragraph":
                    case "bulletList": // Base text style for list items
                      // Defaults are already set based on theme's body/textBody
                      break;
                    default:
                      console.warn(
                        `[LayoutEngine] Unknown block type: ${block.type}. Applying default paragraph styles.`,
                      );
                      // Defaults are paragraph-like, so no specific changes needed here
                      break;
                  }

                  // @ts-expect-error - Tool parameters might be typed as `any`
                  const styleResult = await runtimeTools.applyTextStyle.execute(
                    {
                      anchorKey: actualTextNodeKeyForStyling, // <<< USE THE CORRECTED KEY
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
                      `[LayoutEngine] Failed to apply style for box ${newBoxId} on slide ${pageId}: ${styleResult.error}`,
                    );
                    layoutErrors++;
                  }
                } else if (textNodeOriginalKeyFromEmptyContent) {
                  // block.text was empty
                } else {
                  // Should not happen if addBoxToSlidePage worked
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
          }

          if (createdContentBoxKeys.length > 0 && visualPresent) {
            const contentWidth = (availableWidth - GAP) / 2;
            const visualWidth = contentWidth;

            for (const boxKey of createdContentBoxKeys) {
              const updateRes =
                // @ts-expect-error - tool parameters are typed as `any` for execute
                await runtimeTools.updateBoxPropertiesOnSlidePage.execute({
                  deckNodeKey: currentDeckNodeKey,
                  slideId: pageId,
                  boxId: boxKey,
                  properties: {
                    x: PADDING,
                    y: currentY,
                    width: contentWidth,
                    height: 150,
                  },
                });
              if (!updateRes.success) layoutErrors++;
              currentY += 150 + GAP;
            }

            if (visualElementId) {
              const updateVisRes =
                // @ts-expect-error - tool parameters are typed as `any` for execute
                await runtimeTools.updateSlideElementProperties.execute({
                  deckNodeKey: currentDeckNodeKey,
                  slideId: pageId,
                  elementId: visualElementId,
                  kind: visualAssetInfo.assetType as "image" | "chart",
                  properties: {
                    x: PADDING + contentWidth + GAP,
                    y: PADDING,
                    width: visualWidth,
                    height: SLIDE_HEIGHT - 2 * PADDING,
                  },
                });
              if (!updateVisRes.success) layoutErrors++;
            }
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Applied two-column layout to slide ${pageId}.`,
              },
            });
          } else if (createdContentBoxKeys.length > 0) {
            for (const boxKey of createdContentBoxKeys) {
              const updateRes =
                // @ts-expect-error - tool parameters are typed as `any` for execute
                await runtimeTools.updateBoxPropertiesOnSlidePage.execute({
                  deckNodeKey: currentDeckNodeKey,
                  slideId: pageId,
                  boxId: boxKey,
                  properties: {
                    x: PADDING,
                    y: currentY,
                    width: availableWidth,
                    height: 150,
                  },
                });
              if (!updateRes.success) layoutErrors++;
              currentY += 150 + GAP;
            }
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Applied stacked full-width layout to content on slide ${pageId}.`,
              },
            });
          } else if (visualPresent && visualElementId) {
            const visualW = availableWidth * 0.7;
            const visualH = SLIDE_HEIGHT * 0.7;
            const updateVisRes =
              // @ts-expect-error - tool parameters are typed as `any` for execute
              await runtimeTools.updateSlideElementProperties.execute({
                deckNodeKey: currentDeckNodeKey,
                slideId: pageId,
                elementId: visualElementId,
                kind: visualAssetInfo.assetType as "image" | "chart",
                properties: {
                  x: PADDING + (availableWidth - visualW) / 2,
                  y: (SLIDE_HEIGHT - visualH) / 2,
                  width: visualW,
                  height: visualH,
                },
              });
            if (!updateVisRes.success) layoutErrors++;
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Centered visual asset on slide ${pageId}.`,
              },
            });
          }
        } catch (e) {
          layoutErrors++;
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(`Error laying out slide ${pageId}: ${errorMsg}`);
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Error applying layout to slide ${pageId}: ${errorMsg}`,
            },
          });
        }
      }

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 7 Complete: Layout Engine finished applying layouts to ${pageIds.size} slide(s) (with ${layoutErrors} errors).`,
        },
      });
    },
    [
      chatDispatch,
      editor,
      runtimeTools.addBoxToSlidePage,
      runtimeTools.applyTextStyle,
      runtimeTools.patchNodeByJSON,
      runtimeTools.updateBoxPropertiesOnSlidePage,
      runtimeTools.updateSlideElementProperties,
    ],
  );

  const runStep8_ReviewRefine = useCallback(
    async (
      currentDeckNodeKey: string,
      audienceData: AudienceData | null,
      storyboardData: StoryboardData | null,
      slideContents: SlideContentData[] | null,
      themeSettings: WorkflowThemeSettings | null,
      visualAssetsData: VisualAssetData[] | null,
      errorContext?: string,
    ): Promise<{ finalSummary: string }> => {
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

        const finalSummary = summaryLines.join("\n");

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

      // Reset retry budget at the start of a new workflow execution
      workflowRetryBudgetRef.current = MAX_WORKFLOW_RETRIES;

      let resolvedDeckNodeKey: string | null = deckNodeKey;
      let currentThemeSettings: WorkflowThemeSettings | null = null;

      try {
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
            // @ts-expect-error - tool parameters are typed as `any` for execute
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

        const step1Result = await executeStepWithRetries(
          runStep1_AudiencePlanner,
          "AudiencePlanner",
          params.topic,
          params.who,
          params.outcome,
          params.timebox,
        );

        const deckMetadataForStep1: DeckStrategicMetadata = {
          bigIdea: step1Result.bigIdea,
          audiencePersonaSummary: step1Result.persona,
          targetSlideCount:
            MAX_SLIDES_COUNT !== undefined
              ? MAX_SLIDES_COUNT
              : step1Result.slideCount,
          recommendedTone: step1Result.tone,
          originalUserPrompt: `Topic: ${params.topic}, Audience: ${params.who}, Outcome: ${params.outcome}, Timebox: ${params.timebox},`,
        };

        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: `Setting initial deck metadata for deck: ${resolvedDeckNodeKey}...`,
          },
        });

        if (!runtimeTools.setDeckMetadata) {
          throw new Error("setDeckMetadata tool is not available.");
        }
        const setInitialMetadataResult =
          // @ts-expect-error - tool parameters are typed as `any` for execute
          await runtimeTools.setDeckMetadata.execute({
            deckNodeKey: resolvedDeckNodeKey,
            deckMetadata: deckMetadataForStep1,
          });

        if (!setInitialMetadataResult.success) {
          console.warn(
            `Failed to set initial deck metadata: ${setInitialMetadataResult.error || "Unknown error"}`,
          );
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Warning: Could not set initial deck metadata. ${setInitialMetadataResult.error || "Unknown error"}`,
            },
          });
        }
        currentThemeSettings = await executeStepWithRetries(
          runStep2_StyleStylist,
          "StyleStylist",
          resolvedDeckNodeKey,
          step1Result,
        );
        if (!currentThemeSettings)
          throw new StepError(
            "Theme settings are missing, cannot proceed with Style Stylist.",
            "StyleStylist",
            "currentThemeSettings was null",
          );

        const step2Result = await executeStepWithRetries(
          runStep3_ResearchAgent,
          "ResearchAgent",
          step1Result,
          params.files,
        );
        if (!step2Result) throw new Error("Research failed (step 2)");

        const storyboardSlideCount =
          MAX_SLIDES_COUNT !== undefined
            ? MAX_SLIDES_COUNT
            : step1Result.slideCount;

        const step3Result = await executeStepWithRetries(
          runStep4_StoryboardArchitect,
          "StoryboardArchitect",
          step2Result,
          storyboardSlideCount, // Use the potentially overridden slide count
          resolvedDeckNodeKey,
        );
        if (!step3Result)
          throw new Error("Storyboard Architect failed (step 3)");

        const step4Result = await executeStepWithRetries(
          runStep5_SlideWriter,
          "SlideWriter",
          step3Result,
          resolvedDeckNodeKey,
        );
        if (!step4Result) throw new Error("Slide Writer failed (step 4)");

        let visualAssetsDataResult: VisualAssetData[] | null = null;
        if (step3Result && resolvedDeckNodeKey && currentThemeSettings) {
          visualAssetsDataResult = await executeStepWithRetries(
            runStep6_MediaGenerator,
            "MediaGenerator",
            step3Result,
            resolvedDeckNodeKey,
            currentThemeSettings,
          );
        } else {
          // This case should ideally not be hit if previous steps are mandatory and throw on failure.
          // If storyboard or theme is missing, MediaGenerator would likely fail or do nothing.
          // For robustness, we can log or even throw if this state is unexpected.
          const missingDepsError =
            "Cannot run MediaGenerator due to missing storyboard data or theme settings.";
          console.error(missingDepsError, {
            step3Result,
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

        await executeStepWithRetries(
          runStep7_LayoutEngine,
          "LayoutEngine",
          resolvedDeckNodeKey,
          step4Result,
          visualAssetsDataResult,
          currentThemeSettings,
        );

        const step8Result = await executeStepWithRetries(
          runStep8_ReviewRefine,
          "ReviewRefine",
          resolvedDeckNodeKey,
          step1Result,
          step3Result,
          step4Result,
          currentThemeSettings,
          visualAssetsDataResult,
        );
        if (!step8Result) throw new Error("Review & Refine failed (step 8)");

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
      chatDispatch,
      runStep1_AudiencePlanner,
      runStep3_ResearchAgent,
      runStep4_StoryboardArchitect,
      runStep5_SlideWriter,
      runStep2_StyleStylist,
      runStep6_MediaGenerator,
      runStep7_LayoutEngine,
      runStep8_ReviewRefine,
      deckNodeKey,
      runtimeTools,
      executeStepWithRetries,
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
