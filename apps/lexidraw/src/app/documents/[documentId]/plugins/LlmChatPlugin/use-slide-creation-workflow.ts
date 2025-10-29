/**
 * WHOEVER calls tool.execute will be fired. Tools may under no circumstances be called programmatically.
 */

import { useState, useCallback, useRef } from "react";
import {
  type AppToolResult,
  type RuntimeToolMap,
  useLLM,
  type AppToolCall,
} from "../../context/llm-context";
import { useChatDispatch } from "./llm-chat-context";
import {
  type DeckStrategicMetadata,
  type SlideStrategicMetadata,
  SlideNode,
} from "../../nodes/SlideNode/SlideNode";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $getNodeByKey } from "lexical";
import { useMarkdownTools } from "../../utils/markdown";
import env from "@packages/env";
import type { z } from "zod";
import { useSlideTools, type AudienceDataSchema } from "./tools/slides";
import { useTextTools } from "./tools/text";
import { useListTools } from "./tools/list";
import type { ModelMessage, ToolChoice, ToolSet } from "ai";

interface AudienceData {
  bigIdea: string;
  persona: string;
  slideCount: number;
  tone: string;
  timebox: string;
  files?: File[];
  existingDeckNodeKey?: string;
  logoUrl?: string;
  customTokens?: string;
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

interface BoxWithContent {
  pageId: string;
  boxId: string;
  content: { type: string; text: string };
}

class StepError extends Error {
  public rawResponseText?: string;
  public stepName: string;
  public history?: ModelMessage[];

  constructor(
    message: string,
    stepName: string,
    rawResponseText?: string,
    history?: ModelMessage[],
  ) {
    super(message);
    this.name = "StepError";
    this.stepName = stepName;
    this.rawResponseText = rawResponseText;
    this.history = history;
    Object.setPrototypeOf(this, StepError.prototype);
  }
}

interface RunLLMStepArgs {
  prompt: string;
  tools: RuntimeToolMap;
  generateChatResponse: ReturnType<typeof useLLM>["generateChatResponse"];
  toolChoice?: ToolChoice<ToolSet>;
  signal?: AbortSignal;
}

interface RunLLMStepReturn {
  text: string;
  toolCalls?: AppToolCall[];
  toolResults?: AppToolResult[];
  rawResponseText?: string;
}

const MAX_WORKFLOW_RETRIES = 3;
const MAX_SLIDES_COUNT: number | undefined =
  env.NEXT_PUBLIC_NODE_ENV === "development" ? 3 : undefined;
const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 720;

export function useSlideCreationWorkflow() {
  const [editor] = useLexicalComposerContext();
  const { generateChatResponse } = useLLM();
  const chatDispatch = useChatDispatch();
  const cancellationControllerRef = useRef<AbortController | null>(null);

  const {
    addChartToSlidePage,
    saveDeckTheme,
    generateAndAddImageToSlidePage,
    searchAndAddImageToSlidePage,
    saveStoryboardOutput,
    saveSlideContentAndMetadata,
    updateElementProperties,
    addBoxToSlidePageExec,
    saveAudienceDataTool,
    addSlidePageExec,
  } = useSlideTools();

  const { insertTextNode, applyTextStyle } = useTextTools();
  const { insertListNode } = useListTools();

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
  const [boxesWithContent, setBoxesWithContent] = useState<
    BoxWithContent[] | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);

  const cancelSlideGeneration = useCallback(() => {
    if (cancellationControllerRef.current) {
      cancellationControllerRef.current.abort();
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: "Cancellation request sent.",
        },
      });
    }
  }, [chatDispatch]);

  const runLLMStep = useCallback(
    async ({
      prompt,
      tools,
      generateChatResponse,
      toolChoice,
      signal,
    }: RunLLMStepArgs): Promise<RunLLMStepReturn> => {
      if (signal?.aborted) throw new Error("Operation cancelled by user.");
      const messages: ModelMessage[] = [{ role: "user", content: prompt }];

      console.log(`[runLLMStep] Iteration 1`);
      console.log(
        "[runLLMStep] Sending messages:",
        JSON.stringify(messages, null, 2),
      );

      const resp = await generateChatResponse({
        messages,
        tools,
        prompt: "",
        toolChoice,
        signal,
        mode: "agent",
      });

      console.log(
        "[runLLMStep] Received response:",
        JSON.stringify(resp, null, 2),
      );
      const rawResponseText = resp.text;
      if (signal?.aborted) throw new Error("Operation cancelled by user.");

      if (!resp.toolCalls?.length) {
        return {
          text: resp.text,
          toolCalls: resp.toolCalls,
          toolResults: undefined,
          rawResponseText: rawResponseText,
        };
      }

      // When a tool is required, we execute it once and return immediately.
      // This prevents the loop that was causing the duplicate visual.
      return {
        text: resp.text,
        toolCalls: resp.toolCalls,
        toolResults: resp.toolResults,
        rawResponseText: rawResponseText,
      };
    },
    [],
  );

  const executeStepWithRetries = useCallback(
    async <ArgType extends { errorContext?: string }, ReturnValue>(
      stepFunction: (
        args: ArgType & { signal: AbortSignal },
      ) => Promise<ReturnValue>,
      stepName: string,
      initialArgs: Omit<ArgType, "errorContext" | "signal">,
      signal: AbortSignal,
    ): Promise<ReturnValue> => {
      let lastError: StepError | Error | null = null;
      let currentErrorContext: string | undefined;

      while (workflowRetryBudgetRef.current > 0) {
        if (signal.aborted) {
          throw new Error(
            `Workflow cancelled by user before step ${stepName}.`,
          );
        }
        try {
          const stepArgsObject = {
            ...initialArgs,
            signal,
            ...(currentErrorContext && { errorContext: currentErrorContext }),
          } as ArgType & { signal: AbortSignal };

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
          if (signal.aborted) {
            chatDispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content: `Step ${stepName} cancelled.`,
              },
            });
            throw error; // rethrow cancellation error
          }
          workflowRetryBudgetRef.current -= 1;
          lastError = error instanceof Error ? error : new Error(String(error));

          const attemptNumber =
            MAX_WORKFLOW_RETRIES - workflowRetryBudgetRef.current;

          let logMessage = `Attempt ${attemptNumber}/${MAX_WORKFLOW_RETRIES} for step ${stepName} failed. Error: ${lastError.message}. Retries left: ${workflowRetryBudgetRef.current}.`;

          if (error instanceof StepError) {
            if (error.rawResponseText) {
              logMessage += `\nRaw Response: ${error.rawResponseText}`;
            }
            if (error.history) {
              logMessage += `\nHistory: ${JSON.stringify(error.history, null, 2)}`;
            }
          }
          console.error(logMessage);

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
      signal: AbortSignal;
    }): Promise<AudienceData> => {
      const {
        topic,
        who,
        outcome,
        timebox,
        currentDocumentMarkdown,
        errorContext,
        signal,
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
        ${currentDocumentMarkdown ? `\\nThe user has provided the following document as context:\\n${currentDocumentMarkdown}\\n` : ""}
        ${MAX_SLIDES_COUNT ? `The user has requested max ${MAX_SLIDES_COUNT} slides. You must honor this request.` : ""}
        ${errorContext ? `\\nImportant Context from Previous Attempt:\\n${errorContext}\\n` : ""}
        ▶︎ Call **saveAudienceDataTool** once with:
          { "bigIdea", "persona", "slideCount", "tone" }
        Return nothing else.`.replaceAll("        ", "");

      const { toolResults, rawResponseText } = await runLLMStep({
        prompt,
        // @ts-expect-error - impossible
        tools: { saveAudienceDataTool },
        generateChatResponse,
        toolChoice: "required",
        signal,
      });

      const audienceTool = toolResults?.find(
        (t) => t.toolName === "saveAudienceDataTool",
      );
      if (!audienceTool) {
        throw new StepError(
          "saveAudienceDataTool was not invoked by the LLM.",
          stepName,
          rawResponseText,
        );
      }

      // the args passed to the tool ARE the parsed audience data
      const parsed = audienceTool.args as z.infer<typeof AudienceDataSchema>;
      const finalAudienceData: AudienceData = { ...parsed, timebox };

      setAudienceData(finalAudienceData);
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 1 Complete – Audience Plan
            Big Idea: ${finalAudienceData.bigIdea}
            Persona: ${finalAudienceData.persona}
            Slides:  ${finalAudienceData.slideCount}
            Tone:    ${finalAudienceData.tone}`,
        },
      });

      return finalAudienceData;
    },
    [chatDispatch, generateChatResponse, runLLMStep, saveAudienceDataTool],
  );

  const runStep2_StyleStylist = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      currentAudienceData: AudienceData | null;
      errorContext?: string;
      signal: AbortSignal;
    }): Promise<WorkflowThemeSettings> => {
      const { currentDeckNodeKey, currentAudienceData, errorContext, signal } =
        args;
      const stepName = "StyleStylist";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 2: Brand & Style Stylist...${errorContext ? " (Retrying with error context)" : ""}`,
        },
      });

      const userObjectiveInfo = currentAudienceData
        ? `The presentation's big idea is: "${currentAudienceData.bigIdea}". It is for persona: "${currentAudienceData.persona}" and should have a "${currentAudienceData.tone}" tone.`
        : "The presentation context is not fully defined.";

      const prompt = `You are an expert Brand & Style Specialist.
        ${userObjectiveInfo}
        ${errorContext ? `\n\nImportant Context from Previous Attempt:\n\n${errorContext}\n\n` : ""}
        
        Suggest a comprehensive visual theme and call the **saveDeckTheme** tool with the 'deckNodeKey' as "${currentDeckNodeKey}" and the full theme object for the 'theme' field.
        
        Return nothing else.`.replaceAll("        ", "");

      const { toolResults, rawResponseText } = await runLLMStep({
        prompt,
        // @ts-expect-error - impossible
        tools: { saveDeckTheme },
        generateChatResponse,
        toolChoice: "required",
        signal,
      });

      const themeToolCall = toolResults?.find(
        (t) => t.toolName === "saveDeckTheme",
      );
      if (!themeToolCall) {
        throw new StepError(
          "saveDeckTheme was not invoked by the LLM.",
          stepName,
          rawResponseText,
        );
      }

      // The result of the tool execution contains the theme
      const result = themeToolCall.result as {
        success: boolean;
        theme?: WorkflowThemeSettings;
        error?: string;
      };

      if (!result.success || !result.theme) {
        throw new StepError(
          `saveDeckTheme tool execution failed: ${result.error || "No theme returned."}`,
          stepName,
          rawResponseText,
        );
      }

      const suggestedTheme = result.theme;
      setThemeSettings(suggestedTheme);

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 2 Complete – Theme selected: ${suggestedTheme.templateName || "Custom Theme"}`,
        },
      });

      return suggestedTheme;
    },
    [chatDispatch, runLLMStep, saveDeckTheme, generateChatResponse],
  );

  const runStep3_ResearchAgent = useCallback(
    async (args: {
      audienceDataParam: AudienceData;
      files?: File[];
      currentDocumentMarkdown?: string;
      errorContext?: string;
      signal: AbortSignal;
    }): Promise<ResearchData> => {
      const {
        audienceDataParam,
        files,
        currentDocumentMarkdown,
        errorContext,
        signal,
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
        ? `Additional context from the user's current document is available:
          ---BEGIN DOCUMENT CONTEXT---
          ${currentDocumentMarkdown}
          ---END DOCUMENT CONTEXT---
          This document can be referenced as "the provided document context".
          `.replaceAll("          ", "")
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
        If specific data or facts are drawn from the "provided document context" or named files, try to implicitly ground your findings in that information.`.replaceAll(
        "        ",
        "",
      );
      const resp = await runLLMStep({
        prompt,
        tools: {},
        generateChatResponse,
        signal,
      });

      if (!resp.text) {
        throw new StepError(
          "Research Agent did not return text.",
          stepName,
          "N/A",
        );
      }

      const findings = resp.text;
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
    },
    [chatDispatch, generateChatResponse, runLLMStep],
  );

  const runStep4_StoryboardArchitect = useCallback(
    async (args: {
      researchDataParam: ResearchData;
      slideCount: number;
      resolvedDeckKeyForThisStep: string;
      errorContext?: string;
      signal: AbortSignal;
    }): Promise<StoryboardData> => {
      const {
        researchDataParam,
        slideCount,
        resolvedDeckKeyForThisStep,
        errorContext,
        signal,
      } = args;

      const stepName = "StoryboardArchitect";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 4: ${stepName} (≈${slideCount} slides)…${
            errorContext ? " (retrying with extra context)" : ""
          }`,
        },
      });

      /* ————————————————— PROMPT for Storyboard ————————————————— */
      const storyboardPrompt = `
You are an expert *Storyboard Architect* and visual designer.

Research findings ↓
---
${researchDataParam.findings}
---

Create a visually diverse storyboard containing **exactly ${slideCount} slides**.

For *each* slide provide:

1. "slideNumber"  (integer, starting at 1)
2. "title"
3. "keyMessage"        (markdown – bullets allowed)
4. "visualIdea"        ("None" if not needed)
5. "speakerNotes"
6. "layoutTemplateHint" (pick from: title-slide | chapter-divider | quote-focus | full-width-visual | text-overlay-visual | standard-text-visual | visual-text)

${errorContext ? `\nPREVIOUS-ERROR-CONTEXT:\n${errorContext}\n` : ""}

Respond **only** with one call to **saveStoryboardOutput** whose args include
{ "slides": [ … ] } – the array of objects described above.
`.trim();

      /* ————————————————— Get Storyboard from LLM ————————————————— */
      if (!saveStoryboardOutput) {
        throw new Error(
          "StoryboardArchitect: required tool (saveStoryboardOutput) missing",
        );
      }

      const {
        toolResults: storyboardToolResults,
        rawResponseText: storyboardRawResponseText,
      } = await runLLMStep({
        prompt: storyboardPrompt,
        // @ts-expect-error - saveStoryboardOutput is not typed
        tools: { saveStoryboardOutput },
        generateChatResponse,
        toolChoice: "required",
        signal,
      });

      const sbTool = storyboardToolResults?.find(
        (t) => t.toolName === "saveStoryboardOutput",
      );
      if (!sbTool) {
        throw new StepError(
          "LLM did not call saveStoryboardOutput",
          stepName,
          storyboardRawResponseText ?? JSON.stringify(storyboardToolResults),
        );
      }

      const { slides } = sbTool.args as { slides: SlideOutline[] };
      if (!Array.isArray(slides) || slides.length === 0) {
        throw new StepError(
          "saveStoryboardOutput.args.slides is empty or malformed",
          stepName,
          storyboardRawResponseText ?? JSON.stringify(sbTool.args),
        );
      }

      const created: SlideOutline[] = [];
      let failures = 0;
      for (const outline of slides) {
        if (signal.aborted) throw new Error("Operation cancelled by user.");
        const pageId = `${resolvedDeckKeyForThisStep}-s${outline.slideNumber}-${crypto
          .randomUUID()
          .slice(0, 6)}`;

        const meta: SlideStrategicMetadata = {
          storyboardTitle: outline.title,
          keyMessage: outline.keyMessage,
          keyVisualHint: outline.visualIdea,
          speakerNotes: outline.speakerNotes,
          layoutTemplateHint: outline.layoutTemplateHint,
        };

        try {
          const res = await addSlidePageExec({
            deckNodeKey: resolvedDeckKeyForThisStep,
            newSlideId: pageId,
            slideMetadata: meta,
            focusNewSlide: false,
          });

          if (res.success) {
            created.push({ ...outline, pageId });
          } else {
            failures++;
            console.warn(
              `Slide ${outline.slideNumber} creation via tool failed: ${res.error}`,
            );
          }
        } catch (e) {
          failures++;
          console.error(
            `Error during page creation for slide ${outline.slideNumber}:`,
            e,
          );
          const msg =
            e instanceof Error ? e.message : `unknown error: ${String(e)}`;
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `⚠️ Slide page creation for ${outline.slideNumber} failed: ${msg}`,
            },
          });
        }
      }

      const storyboard: StoryboardData = { slides: created };
      setStoryboardData(storyboard);

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 4 ✓ — storyboard ready (${created.length}/${
            slides.length
          } slides materialised)${failures > 0 ? ` (${failures} failed)` : ""}.`,
        },
      });

      return storyboard;
    },
    [
      chatDispatch,
      saveStoryboardOutput,
      runLLMStep,
      generateChatResponse,
      addSlidePageExec,
    ],
  );

  const runStep5_SlideWriter = useCallback(
    async (args: {
      storyboardDataParam: StoryboardData;
      currentDeckNodeKey: string;
      errorContext?: string;
      signal: AbortSignal;
    }): Promise<SlideContentData[]> => {
      const { storyboardDataParam, currentDeckNodeKey, errorContext, signal } =
        args;
      const stepName = "SlideWriter";

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 5: ${stepName}…${
            errorContext ? " (retrying)" : ""
          }`,
        },
      });

      if (!saveSlideContentAndMetadata) {
        throw new Error(
          "SlideWriter: required tool (saveSlideContentAndMetadata) missing",
        );
      }

      const generated: SlideContentData[] = [];
      let failures = 0;

      for (const outline of storyboardDataParam.slides) {
        if (signal.aborted) throw new Error("Operation cancelled by user.");
        if (!outline.pageId) {
          failures++;
          continue;
        }

        const prompt = `
You are an expert *slide writer*.

Slide title: "${outline.title}"
Key message: "${outline.keyMessage}"
Speaker notes (draft): "${outline.speakerNotes || "None"}"

${errorContext ? `PREVIOUS-ERROR-CONTEXT:\n${errorContext}\n` : ""}

First, produce the final *body content* and improved *speaker notes*.
Allowed body content types are: heading1 | heading2 | paragraph | bulletList.
For bulletList, join items with new-lines.

Then, call the **saveSlideContentAndMetadata** tool with:
- 'deckNodeKey': '${currentDeckNodeKey}'
- 'slideId': '${outline.pageId}'
- 'bodyContent': the generated 'bodyContent'
- 'refinedSpeakerNotes': the generated 'refinedSpeakerNotes'

Return nothing else.
`
          .replaceAll("          ", "")
          .trim();

        try {
          const { toolResults, rawResponseText } = await runLLMStep({
            prompt,
            tools: {
              // @ts-expect-error - impossible
              saveSlideContentAndMetadata,
            },
            generateChatResponse,
            toolChoice: "required",
            signal,
          });

          const toolCall = toolResults?.find(
            (t) => t.toolName === "saveSlideContentAndMetadata",
          );
          if (!toolCall) {
            throw new StepError(
              "LLM failed to call saveSlideContentAndMetadata",
              `${stepName} – slide ${outline.slideNumber}`,
              rawResponseText ?? JSON.stringify(toolResults),
            );
          }

          // The arguments for the content are in the first sub-call of the combined tool
          const result = toolCall.result as {
            success: boolean;
            content?: {
              pageId: string;
              bodyContent: { type: string; text: string }[];
              refinedSpeakerNotes: string;
            };
            error?: string;
          };

          if (!result.success || !result.content) {
            throw new StepError(
              `saveSlideContentAndMetadata tool execution failed: ${
                result.error || "No content returned."
              }`,
              `${stepName} - slide ${outline.slideNumber}`,
              rawResponseText,
            );
          }

          const { pageId, bodyContent, refinedSpeakerNotes } = result.content;

          generated.push({
            pageId,
            structuredBodyContent: bodyContent,
            refinedSpeakerNotes,
          });

          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `✔️ Slide ${outline.slideNumber} content saved`,
            },
          });
        } catch (e) {
          failures++;
          const msg =
            e instanceof Error ? e.message : `unknown error: ${String(e)}`;
          console.error(msg);
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `⚠️ Slide ${outline.slideNumber} failed: ${msg}`,
            },
          });
        }
      }

      if (generated.length === 0) {
        throw new StepError(
          "SlideWriter produced no successful slides",
          stepName,
        );
      }

      setSlideContents(generated);

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 5 ✓ — content ready for ${generated.length} slide(s)${
            failures ? ` (${failures} failed)` : ""
          }.`,
        },
      });

      return generated;
    },
    [
      chatDispatch,
      generateChatResponse,
      runLLMStep,
      saveSlideContentAndMetadata,
    ],
  );

  const runStep6_MediaGenerator = useCallback(
    async (args: {
      storyboardDataParam: StoryboardData;
      currentDeckNodeKey: string;
      currentThemeSettings: WorkflowThemeSettings | null;
      errorContext?: string;
      signal: AbortSignal;
    }): Promise<VisualAssetData[]> => {
      const {
        storyboardDataParam,
        currentDeckNodeKey,
        currentThemeSettings,
        errorContext,
        signal,
      } = args;
      const stepName = "MediaGenerator";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 6: ${stepName}…${
            errorContext ? " (retrying)" : ""
          }`,
        },
      });

      if (
        !generateAndAddImageToSlidePage ||
        !addChartToSlidePage ||
        !searchAndAddImageToSlidePage
      ) {
        throw new Error("MediaGenerator: image/chart tools missing");
      }

      const generated: VisualAssetData[] = [];
      let failures = 0;

      console.log(
        `[${stepName}] START: Beginning media generation for ${storyboardDataParam.slides.length} slides.`,
      );

      for (const outline of storyboardDataParam.slides) {
        if (signal.aborted) throw new Error("Operation cancelled by user.");
        console.log(
          `[${stepName}] Processing slide #${outline.slideNumber} ('${outline.title}') - Page ID: ${outline.pageId}`,
        );
        if (!outline.pageId) {
          console.warn(
            `[${stepName}] Skipping slide #${outline.slideNumber} due to missing pageId.`,
          );
          continue;
        }

        if (
          !outline.visualIdea ||
          outline.visualIdea.trim().toLowerCase() === "none"
        ) {
          console.log(
            `[${stepName}] No visual idea for slide #${outline.slideNumber}. Skipping to next.`,
          );
          generated.push({
            pageId: outline.pageId,
            assetType: "none",
            visualIdea: outline.visualIdea,
          });
          continue;
        }

        const prompt = `
  You are a *Visual-Asset-Chooser*.
  
  Slide : #${outline.slideNumber} "${outline.title}"
  Visual idea : "${outline.visualIdea}"
  Theme : ${currentThemeSettings?.templateName || "generic"}
  
  Pick ONE option:

  1.  Call **searchAndAddImageToSlidePage** with
      { "deckNodeKey": "${currentDeckNodeKey}", "slideId": "${outline.pageId}", "query": "<search query based on visual idea>" }
  
  2.  Call **addChartToSlidePage** with
      { "deckNodeKey": "${currentDeckNodeKey}", "slideId": "${outline.pageId}", "chartType": "<bar|line|pie>", "chartData": [...], "chartConfig": {} }
  
  3.  Call **generateAndAddImageToSlidePage** with
      { "deckNodeKey": "${currentDeckNodeKey}", "slideId": "${outline.pageId}", "prompt": "<DALL-E prompt>" }
      Depending on environment, this tool may be disabled. In that case, use searchAndAddImageToSlidePage instead.
  
  Respond ONLY with the tool call.
  `.trim();

        try {
          console.log(
            `[${stepName}] Calling LLM for slide #${outline.slideNumber} with visual idea: "${outline.visualIdea}"`,
          );
          const { toolResults, rawResponseText } = await runLLMStep({
            prompt,
            tools: {
              // generateAndAddImageToSlidePage,
              // @ts-expect-error - searchAndAddImageToSlidePage is not typed
              searchAndAddImageToSlidePage,
              // @ts-expect-error - addChartToSlidePage is not typed
              addChartToSlidePage,
            },
            generateChatResponse,
            toolChoice: "required",
            signal,
          });

          console.log(
            `[${stepName}] LLM response for slide #${outline.slideNumber}:`,
            {
              toolResults: JSON.stringify(toolResults, null, 2),
              rawResponseText,
            },
          );

          if (!toolResults || toolResults.length === 0) {
            const errorMsg = `No tool invoked by LLM for slide #${outline.slideNumber}.`;
            console.error(errorMsg, `Raw response: ${rawResponseText}`);
            throw new StepError(errorMsg, stepName, rawResponseText);
          }

          for (const call of toolResults) {
            console.log(
              `[${stepName}] Processing tool call '${call.toolName}' for slide #${outline.slideNumber}. Args:`,
              call.args,
            );
            if (call.toolName === "generateAndAddImageToSlidePage") {
              const { slideId: pageId, prompt: imagePrompt } = call.args as {
                slideId: string;
                prompt: string;
              };
              const newNodeKey = (call.result as ToolExecutionResultForMedia)
                .content?.newNodeKey;
              console.log(
                `[${stepName}] Result from generateAndAddImageToSlidePage: newNodeKey=${newNodeKey}`,
              );
              generated.push({
                pageId,
                assetType: "image",
                visualIdea: outline.visualIdea,
                imagePrompt,
                imageId: newNodeKey,
              });
            } else if (call.toolName === "addChartToSlidePage") {
              const { slideId, chartType } = call.args as {
                slideId: string;
                chartType: string;
              };
              const newNodeKey = (call.result as ToolExecutionResultForMedia)
                .content?.newNodeKey;
              console.log(
                `[${stepName}] Result from addChartToSlidePage: newNodeKey=${newNodeKey}`,
              );
              generated.push({
                pageId: slideId,
                assetType: "chart",
                visualIdea: outline.visualIdea,
                chartId: newNodeKey,
                chartType,
              });
            } else if (call.toolName === "searchAndAddImageToSlidePage") {
              const { slideId: pageId, query: imagePrompt } = call.args as {
                slideId: string;
                query: string;
              };
              const newNodeKey = (call.result as ToolExecutionResultForMedia)
                .content?.newNodeKey;
              console.log(
                `[${stepName}] Result from searchAndAddImageToSlidePage: newNodeKey=${newNodeKey}`,
              );
              generated.push({
                pageId,
                assetType: "image",
                visualIdea: outline.visualIdea,
                imagePrompt, // Storing query as imagePrompt
                imageId: newNodeKey,
              });
            } else {
              const errorMsg = `Unexpected tool ${call.toolName} called for slide #${outline.slideNumber}.`;
              console.error(errorMsg);
              throw new StepError(errorMsg, stepName, rawResponseText);
            }
          }
        } catch (e) {
          failures++;
          const msg = e instanceof Error ? e.message : String(e);
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `⚠️ Slide ${outline.slideNumber} media failed: ${msg}`,
            },
          });
        }
      }

      console.log(
        `[${stepName}] END: Media generation finished. Total generated data points: ${
          generated.length
        }. Visual assets added: ${
          generated.filter((g) => g.assetType !== "none").length
        }. Failures: ${failures}.`,
      );

      if (generated.length === 0) {
        throw new StepError("MediaGenerator produced nothing", stepName);
      }

      setVisualAssetsData(generated);
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 6 ✓ — media ready for ${
            generated.filter((g) => g.assetType !== "none").length
          } slide(s)${failures ? ` (${failures} failed/skipped)` : ""}.`,
        },
      });
      return generated;
    },
    [
      chatDispatch,
      generateAndAddImageToSlidePage,
      addChartToSlidePage,
      searchAndAddImageToSlidePage,
      runLLMStep,
      generateChatResponse,
    ],
  );

  const runStep7_AddEmptyBoxes = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      allSlideContents: SlideContentData[] | null;
      signal: AbortSignal;
      errorContext?: string;
    }): Promise<BoxWithContent[]> => {
      const { currentDeckNodeKey, allSlideContents, signal } = args;
      const stepName = "AddEmptyBoxes";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 7: ${stepName} (Programmatic)...`,
        },
      });

      if (!addBoxToSlidePageExec) {
        throw new Error("addBoxToSlidePageExec tool is missing");
      }

      const createdBoxes: BoxWithContent[] = [];
      let failures = 0;

      if (allSlideContents) {
        for (const slideContent of allSlideContents) {
          if (signal.aborted) throw new Error("Operation cancelled by user.");
          if (
            !slideContent.pageId ||
            !slideContent.structuredBodyContent ||
            slideContent.structuredBodyContent.length === 0
          ) {
            continue;
          }

          for (const contentBlock of slideContent.structuredBodyContent) {
            try {
              const result = await addBoxToSlidePageExec({
                deckNodeKey: currentDeckNodeKey,
                slideId: slideContent.pageId,
              });

              if (result.success && result.content?.newNodeKey) {
                createdBoxes.push({
                  pageId: slideContent.pageId,
                  boxId: result.content.newNodeKey,
                  content: contentBlock,
                });
              } else {
                failures++;
                console.warn(
                  `Programmatic box creation via tool failed: ${result.error}`,
                );
              }
            } catch (e) {
              failures++;
              const msg = e instanceof Error ? e.message : String(e);
              console.error(
                `Programmatic box creation failed for slide ${slideContent.pageId}:`,
                e,
              );
              chatDispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "system",
                  content: `⚠️ Box creation for slide ${slideContent.pageId} failed: ${msg}`,
                },
              });
            }
          }
        }
      }

      if (createdBoxes.length === 0 && allSlideContents?.length) {
        throw new StepError("No boxes were created.", stepName);
      }

      setBoxesWithContent([...createdBoxes]);
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 7 ✓ — empty boxes created (${createdBoxes.length})${
            failures > 0 ? ` (${failures} failed)` : ""
          }.`,
        },
      });
      return createdBoxes;
    },
    [addBoxToSlidePageExec, chatDispatch],
  );

  const runStep8_PopulateBoxesWithText = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      boxesWithContent: BoxWithContent[] | null;
      signal: AbortSignal;
      errorContext?: string;
    }): Promise<void> => {
      const { currentDeckNodeKey, boxesWithContent, signal } = args;
      const stepName = "PopulateBoxesWithText";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 8: ${stepName}…`,
        },
      });

      if (!insertTextNode) {
        throw new Error("insertTextNode tool is missing");
      }
      if (!boxesWithContent) {
        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: "Skipping PopulateBoxes step, no box data available.",
          },
        });
        return;
      }

      // Group boxes by slide to make one LLM call per slide
      const boxesBySlide = boxesWithContent.reduce(
        (acc, box) => {
          if (!acc[box.pageId]) {
            acc[box.pageId] = [];
          }
          acc[box.pageId]?.push(box);
          return acc;
        },
        {} as Record<string, BoxWithContent[]>,
      );

      let failures = 0;
      for (const slideId in boxesBySlide) {
        if (signal.aborted) throw new Error("Operation cancelled by user.");

        const slideBoxes = boxesBySlide[slideId];
        if (!slideBoxes) {
          continue;
        }
        const prompt = `
You are a slide content writer. For slide with ID '${slideId}', you must populate the following ${
          slideBoxes.length
        } boxes with their corresponding content by calling the **insertTextNode** tool for each.

${slideBoxes
  .map((box) => {
    const editorKey = `${currentDeckNodeKey}/${slideId}/${box.boxId}`;
    const sanitizedText = box.content.text.replace(/"/g, '\\"');
    return `- Box ID: "${box.boxId}"
  - Content Type: "${box.content.type}"
  - Text: "${sanitizedText}" (editorKey: "${editorKey}")`;
  })
  .join("\n\n")}

For each box, choose the appropriate tool:
 • **insertTextNode** for paragraphs or single-line text.
 • **insertListNode** when the contentType is "bulletList". Pass the full multi-line text joined by new-lines; the tool will split it into individual bullets automatically. Use listType="bullet".

Make calls in parallel where possible.

Each call MUST include the parameter \`deckNodeKey\` set to "${currentDeckNodeKey}" and the correct \`slideId\` for the element.

You are expected to make multiple parallel tool calls in a single response, one per element.
        `.trim();

        try {
          const { toolResults, rawResponseText } = await runLLMStep({
            prompt,
            tools: {
              // @ts-expect-error - tools untyped
              insertTextNode,
              // @ts-expect-error - tools untyped
              insertListNode,
            },
            generateChatResponse,
            toolChoice: "auto",
            signal,
          });

          if (toolResults) {
            for (const tr of toolResults) {
              if (
                tr.toolName === "insertTextNode" &&
                (tr.result as { success: boolean }).success
              ) {
                // No longer tracking individual text node keys
              }
            }
          }

          const successfulCalls =
            toolResults?.filter((r) => {
              const ok = (r.result as { success: boolean }).success;
              return (
                ok &&
                ["insertTextNode", "insertListNode"].includes(
                  r.toolName as string,
                )
              );
            }).length ?? 0;

          if (successfulCalls < slideBoxes.length) {
            failures += slideBoxes.length - successfulCalls;
            throw new StepError(
              `LLM failed to populate all boxes for slide ${slideId}`,
              stepName,
              rawResponseText,
            );
          }
        } catch (e) {
          failures++;
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`Box population failed for slide ${slideId}:`, e);
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `⚠️ Box population for slide ${slideId} failed: ${msg}`,
            },
          });
        }
      }

      // Persist boxes for later layout step (content only)
      setBoxesWithContent(boxesWithContent);

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 8 ✓ — text boxes populated${
            failures > 0 ? ` (${failures} failed)` : ""
          }.`,
        },
      });
    },
    [
      chatDispatch,
      generateChatResponse,
      insertListNode,
      insertTextNode,
      runLLMStep,
    ],
  );

  const runStep9_LayoutRefinement = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      storyboardDataParam: StoryboardData | null;
      allBoxesWithContent: BoxWithContent[] | null;
      allVisualAssets: VisualAssetData[] | null;
      currentThemeSettings: WorkflowThemeSettings | null;
      errorContext?: string;
      signal: AbortSignal;
    }): Promise<void> => {
      const {
        currentDeckNodeKey,
        storyboardDataParam,
        allBoxesWithContent,
        allVisualAssets,
        errorContext,
        signal,
      } = args;

      const stepName = "LayoutRefinement";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 9: ${stepName}…${
            errorContext ? " (retrying)" : ""
          }`,
        },
      });

      if (!updateElementProperties) {
        throw new Error(
          "LayoutRefinement: required tool (updateElementProperties) missing",
        );
      }

      const pages = storyboardDataParam?.slides ?? [];
      let failures = 0;

      for (const outline of pages) {
        if (signal.aborted) throw new Error("Operation cancelled by user.");
        if (!outline.pageId) continue;

        const textElements =
          allBoxesWithContent?.filter((b) => b.pageId === outline.pageId) ?? [];

        const vis = allVisualAssets?.find((v) => v.pageId === outline.pageId);

        const textElementsPromptInfo = textElements
          .map((box) => {
            const editorKey = `${currentDeckNodeKey}/${outline.pageId}/${box.boxId}`;
            return `- Text Box (ID: "${box.boxId}", Kind: "box"): "${box.content.text}" (editorKey: "${editorKey}")`;
          })
          .join("\n");

        const visualAssetPromptInfo =
          vis && vis.assetType !== "none"
            ? `- Visual Asset (ID: "${
                vis.chartId || vis.imageId
              }", Kind: "${vis.assetType}")`
            : "";

        const prompt = `
You are a professional Slide Layout Designer. Your task is to create a well-balanced and visually appealing layout for a slide by arranging the existing elements.

**Slide Information:**
- Slide ID: ${outline.pageId}
- Slide Dimensions: ${SLIDE_WIDTH}px width, ${SLIDE_HEIGHT}px height. All coordinates and dimensions must be in absolute pixels.
- Layout Hint: ${outline.layoutTemplateHint || "standard-text-visual"}
${errorContext ? `\n- Previous Error Context: ${errorContext}` : ""}

**Elements on Slide:**
${textElementsPromptInfo}
${visualAssetPromptInfo}

**Instructions:**
For layout you have two tools:
1. **updateElementProperties** – use for position/size/zIndex and backgroundColor.
2. **applyTextStyle** – use to set rich-text styles *inside* a text box. Call it once per box after positioning.

For **applyTextStyle** pass the \`editorKey\` exactly as provided for the box above. \`anchorKey\` is optional; omit it unless you have a specific reason.

Optional style fields you can set: \`fontSize\` (e.g. "32px"), \`fontWeight\`, \`fontStyle\`, \`color\`, \`backgroundColor\`, \`textAlign\`.

\`deckNodeKey\` and \`slideId\` are ignored by this tool but you may include them for clarity.

Acceptable \`properties\` keys for \`updateElementProperties\` are:
- x, y, width, height, zIndex
- backgroundColor (boxes)

Each call MUST include the parameter \`deckNodeKey\` set to "${currentDeckNodeKey}" and the correct \`slideId\` for the element.

You are expected to make multiple parallel tool calls in a single response, one per element.
`
          .replaceAll("          ", "")
          .trim();

        try {
          const { toolResults, rawResponseText } = await runLLMStep({
            prompt,
            // @ts-expect-error - impossible
            tools: { updateElementProperties, applyTextStyle },
            generateChatResponse,
            toolChoice: "auto",
            signal,
          });

          if (!toolResults || toolResults.length === 0) {
            throw new StepError(
              "LLM did not return any tool calls for layout.",
              `${stepName} - Slide ${outline.slideNumber}`,
              rawResponseText,
            );
          }

          const successfulUpdates = toolResults.filter(
            (call) =>
              call.toolName === "updateElementProperties" &&
              (call.result as { success: boolean }).success,
          ).length;

          if (successfulUpdates === 0 && toolResults.length > 0) {
            // Throw only if there were attempts but all failed.
            throw new StepError(
              "All layout update tool calls failed.",
              `${stepName} - Slide ${outline.slideNumber}`,
              rawResponseText,
            );
          }
        } catch (e) {
          failures++;
          const msg = e instanceof Error ? e.message : String(e);
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `⚠️ Layout for slide ${outline.slideNumber} failed: ${msg}`,
            },
          });
        }
      }

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 9 ✓ — layout pass complete${
            failures ? ` (${failures} slide(s) failed)` : ""
          }.`,
        },
      });
    },
    [
      chatDispatch,
      updateElementProperties,
      runLLMStep,
      applyTextStyle,
      generateChatResponse,
    ],
  );

  const runStep10_ReviewRefine = useCallback(
    async (args: {
      currentDeckNodeKey: string;
      audienceData: AudienceData | null;
      storyboardData: StoryboardData | null;
      slideContents: SlideContentData[] | null;
      themeSettings: WorkflowThemeSettings | null;
      visualAssetsData: VisualAssetData[] | null;
      errorContext?: string;
      signal: AbortSignal;
    }): Promise<{ finalSummary: string }> => {
      const {
        currentDeckNodeKey,
        audienceData,
        storyboardData,
        slideContents,
        themeSettings,
        visualAssetsData,
        errorContext,
        signal,
      } = args;

      const stepName = "ReviewRefine";
      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "system",
          content: `Starting Step 10: ${stepName}…${
            errorContext ? " (retrying)" : ""
          }`,
        },
      });

      if (signal.aborted) throw new Error("Operation cancelled by user.");

      if (!currentDeckNodeKey) {
        throw new StepError("Deck key missing", stepName);
      }

      const summary = `
        Deck             : ${currentDeckNodeKey}
        Big idea         : ${audienceData?.bigIdea || "?"}
        Slides generated : ${slideContents?.length || 0}/${storyboardData?.slides.length || 0}
        Theme            : ${themeSettings?.templateName || "custom"}
        Visuals placed   : ${
          visualAssetsData?.filter((v) => v.assetType !== "none").length || 0
        }
        `
        .replaceAll("        ", "")
        .trim();

      chatDispatch({
        type: "push",
        msg: {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Step 10 ✓ — workflow complete!\n\n${summary}`,
        },
      });

      return { finalSummary: summary };
    },
    [chatDispatch],
  );

  const startSlideGeneration = useCallback(
    async (params: SlideGenerationParams) => {
      cancellationControllerRef.current = new AbortController();
      const signal = cancellationControllerRef.current.signal;

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
      let currentBoxesWithContent: BoxWithContent[] | null = null;

      try {
        if (signal.aborted) {
          throw new Error("Workflow cancelled before starting.");
        }
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

          let newDeckKey: string | null = null;
          editor.update(() => {
            const root = $getRoot();
            const newSlideDeckNode = SlideNode.$createSlideNode({
              slides: [],
              currentSlideId: null,
            });
            root.append(newSlideDeckNode);
            newDeckKey = newSlideDeckNode.getKey();
          });

          if (newDeckKey) {
            resolvedDeckNodeKey = newDeckKey;
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
            throw new Error(`Failed to create new slide deck: "Unknown error"`);
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
          signal,
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

        editor.update(() => {
          if (!resolvedDeckNodeKey) {
            console.error(
              "Cannot set deck metadata, deck node key is missing.",
            );
            return;
          }
          const deckNode = $getNodeByKey<SlideNode>(resolvedDeckNodeKey);
          if (!SlideNode.$isSlideDeckNode(deckNode)) {
            console.error(
              `Node with key ${resolvedDeckNodeKey} is not a valid SlideDeckNode.`,
            );
            return;
          }

          const currentData = deckNode.getData();
          deckNode.setData({
            ...currentData,
            deckMetadata: {
              ...(currentData.deckMetadata || {}),
              ...deckMetadataForStep1,
            },
          });
        });

        currentThemeSettings = await executeStepWithRetries(
          runStep2_StyleStylist,
          "StyleStylist",
          {
            currentDeckNodeKey: resolvedDeckNodeKey,
            currentAudienceData: currentAudienceData,
          },
          signal,
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
          signal,
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
          signal,
        );
        setStoryboardData(currentStoryboardData);

        currentSlideContents = await executeStepWithRetries(
          runStep5_SlideWriter,
          "SlideWriter",
          {
            storyboardDataParam: currentStoryboardData,
            currentDeckNodeKey: resolvedDeckNodeKey,
          },
          signal,
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
            signal,
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

        currentBoxesWithContent = await executeStepWithRetries(
          runStep7_AddEmptyBoxes,
          "AddEmptyBoxes",
          {
            currentDeckNodeKey: resolvedDeckNodeKey,
            allSlideContents: currentSlideContents,
          },
          signal,
        );
        setBoxesWithContent(currentBoxesWithContent);

        await executeStepWithRetries(
          runStep8_PopulateBoxesWithText,
          "PopulateBoxesWithText",
          {
            currentDeckNodeKey: resolvedDeckNodeKey,
            boxesWithContent: currentBoxesWithContent,
          },
          signal,
        );

        await executeStepWithRetries(
          runStep9_LayoutRefinement,
          "LayoutRefinement",
          {
            currentDeckNodeKey: resolvedDeckNodeKey,
            storyboardDataParam: currentStoryboardData,
            allBoxesWithContent: currentBoxesWithContent,
            allVisualAssets: currentVisualAssetsData,
            currentThemeSettings: currentThemeSettings,
          },
          signal,
        );

        const step10Result = await executeStepWithRetries(
          runStep10_ReviewRefine,
          "ReviewRefine",
          {
            currentDeckNodeKey: resolvedDeckNodeKey,
            audienceData: currentAudienceData,
            storyboardData: currentStoryboardData,
            slideContents: currentSlideContents,
            themeSettings: currentThemeSettings,
            visualAssetsData: currentVisualAssetsData,
          },
          signal,
        );

        chatDispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: `Slide generation workflow steps concluded. Final summary from Review & Refine: ${step10Result.finalSummary}`,
          },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Slide generation workflow failed:", error);

        if (
          error instanceof Error &&
          (error.name === "AbortError" || errorMsg.includes("cancel"))
        ) {
          console.log("Workflow was cancelled by user.");
          chatDispatch({
            type: "push",
            msg: {
              id: crypto.randomUUID(),
              role: "system",
              content: `Workflow cancelled by user.`,
            },
          });
        } else {
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
        }
      } finally {
        setIsLoading(false);
        cancellationControllerRef.current = null;
      }
    },
    [
      chatDispatch,
      deckNodeKey,
      convertEditorStateToMarkdown,
      editor,
      executeStepWithRetries,
      runStep1_AudiencePlanner,
      runStep2_StyleStylist,
      runStep3_ResearchAgent,
      runStep4_StoryboardArchitect,
      runStep5_SlideWriter,
      runStep9_LayoutRefinement,
      runStep10_ReviewRefine,
      runStep6_MediaGenerator,
      runStep7_AddEmptyBoxes,
      runStep8_PopulateBoxesWithText,
    ],
  );

  return {
    startSlideGeneration,
    cancelSlideGeneration,
    isLoading,
    audienceData,
    researchData,
    storyboardData,
    deckNodeKey,
    slideContents,
    themeSettings,
    visualAssetsData,
    boxesWithContent,
  };
}
