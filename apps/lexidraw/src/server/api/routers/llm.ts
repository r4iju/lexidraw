import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  generateText,
  generateObject,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { recordLlmAudit, withTiming } from "~/server/audit/llm-audit";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { generateUUID } from "~/lib/utils";
import env from "@packages/env";

export const llmRouter = createTRPCRouter({
  generate: protectedProcedure
    .input(
      z.object({
        system: z.string().optional(),
        prompt: z.string().optional(),
        messages: z.array(z.any()).optional(),
        temperature: z.number().optional(),
        maxOutputTokens: z.number().optional(),
        mode: z.enum(["chat", "agent"]).optional().default("chat"),
        entityId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const system = (input.system ?? "").toString();
      const inputMessages = Array.isArray(input.messages)
        ? (input.messages as ModelMessage[])
        : undefined;
      const hasMessages =
        Array.isArray(inputMessages) && inputMessages.length > 0;
      const prompt = (input.prompt ?? (hasMessages ? "" : "")).toString();
      if (!hasMessages && !prompt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Missing prompt or messages",
        });
      }

      const mode = (input.mode === "agent" ? "agent" : "chat") as
        | "chat"
        | "agent";

      // Get effective config from policies (with user overrides)
      const cfg = await getEffectiveLlmConfig({
        mode,
        userConfig: ctx.session?.user?.config?.llm as {
          chat?: {
            provider: string;
            modelId: string;
            temperature: number;
            maxOutputTokens: number;
          };
          agent?: {
            provider: string;
            modelId: string;
            temperature: number;
            maxOutputTokens: number;
          };
        },
      });

      const effectiveTemperature =
        typeof input.temperature === "number"
          ? input.temperature
          : cfg.temperature;
      const effectiveMaxTokens = cfg.maxOutputTokens;

      const provider = cfg.provider;
      const modelId = cfg.modelId;

      // Use app-level API keys
      const openaiApiKey = env.OPENAI_API_KEY;
      const googleApiKey = env.GOOGLE_API_KEY;

      let model: ReturnType<
        | ReturnType<typeof createOpenAI>
        | ReturnType<typeof createGoogleGenerativeAI>
      > | null = null;
      if (provider === "openai") {
        if (!openaiApiKey) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Missing OpenAI API key. Please set OPENAI_API_KEY environment variable.",
          });
        }
        const openai = createOpenAI({ apiKey: openaiApiKey });
        model = openai(modelId);
      } else if (provider === "google") {
        if (!googleApiKey) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Missing Google API key. Please set GOOGLE_API_KEY environment variable.",
          });
        }
        const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
        model = google(modelId);
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unsupported provider",
        });
      }

      try {
        const { result, elapsedMs } = await withTiming(() =>
          generateText({
            model: model as unknown as LanguageModel,
            ...(hasMessages && inputMessages
              ? { messages: inputMessages }
              : { prompt }),
            system,
            temperature: effectiveTemperature,
            maxOutputTokens: effectiveMaxTokens,
          }),
        );

        const usage = result.usage as
          | {
              promptTokens?: number;
              completionTokens?: number;
              totalTokens?: number;
              inputTokens?: number;
              outputTokens?: number;
            }
          | undefined;
        await recordLlmAudit({
          requestId: generateUUID(),
          timestampMs: Date.now(),
          route: "trpc/llm.generate",
          mode,
          userId,
          entityId: input.entityId ?? null,
          provider,
          modelId,
          temperature: effectiveTemperature,
          maxOutputTokens: effectiveMaxTokens,
          usage: usage
            ? {
                promptTokens: usage.promptTokens ?? usage.inputTokens ?? 0,
                completionTokens:
                  usage.completionTokens ?? usage.outputTokens ?? 0,
                totalTokens:
                  usage.totalTokens ??
                  (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
              }
            : null,
          latencyMs: Math.round(elapsedMs),
          stream: false,
          promptLen: hasMessages ? undefined : prompt.length,
          messagesCount: hasMessages ? inputMessages?.length : undefined,
        });

        return { text: result.text };
      } catch (e) {
        await recordLlmAudit({
          requestId: generateUUID(),
          timestampMs: Date.now(),
          route: "trpc/llm.generate",
          mode,
          userId,
          entityId: input.entityId ?? null,
          provider,
          modelId,
          temperature: effectiveTemperature,
          maxOutputTokens: effectiveMaxTokens,
          usage: null,
          latencyMs: 0,
          stream: false,
          errorCode: "GenerationError",
          errorMessage: e instanceof Error ? e.message : String(e),
          httpStatus: 500,
        }).catch(() => {});
        const msg = e instanceof Error ? e.message : String(e);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: msg || "Generation error",
        });
      }
    }),

  plan: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
        availableTools: z.array(z.string()).default([]),
        max: z.number().int().min(1).max(10).default(6),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const { prompt, availableTools, max } = input;

      const cfg = await getEffectiveLlmConfig({
        mode: "agent",
        userConfig: ctx.session?.user?.config?.llm as {
          agent?: { provider: string; modelId: string; temperature: number };
        },
      });

      const provider = cfg.provider;
      const modelId = cfg.modelId;

      const openaiApiKey = env.OPENAI_API_KEY;
      const googleApiKey = env.GOOGLE_API_KEY;

      // Choose a chat-capable, non-reasoning model for planner. Override if needed.
      type PlannerModel =
        | ReturnType<ReturnType<typeof createOpenAI>>
        | ReturnType<ReturnType<typeof createGoogleGenerativeAI>>;
      let model: PlannerModel | null = null;
      let fallbackModel: PlannerModel | null = null;
      if (provider === "openai") {
        if (!openaiApiKey)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Missing OpenAI API key",
          });
        const openai = createOpenAI({ apiKey: openaiApiKey });
        // Align planner with effective model when possible; fallback to a small chat model
        model = openai(modelId || "gpt-4o-mini");
        fallbackModel = openai("gpt-4o");
      } else if (provider === "google") {
        if (!googleApiKey)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Missing Google API key",
          });
        const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
        model = google(modelId || "gemini-1.5-flash");
        fallbackModel = google("gemini-1.5-pro");
      } else {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Unsupported provider",
        });
      }

      const startMs = Date.now();
      const isDev = process.env.NODE_ENV !== "production";
      const log = (event: string, data: Record<string, unknown>) => {
        if (!isDev) return;
        try {
          console.log(
            JSON.stringify({
              source: "planner",
              event,
              route: "trpc/llm.plan",
              ...data,
            }),
          );
        } catch {
          // ignore logging failures
        }
      };

      log("request_start", {
        userId,
        provider,
        modelId,
        promptLen: prompt.length,
        availableCount: availableTools.length,
        max,
      });
      log("request_debug", {
        userId,
        prompt,
        availableTools,
      });

      const plannerSystem = [
        "You are a tool selection planner.",
        `From the provided list of available tool names, choose at most ${String(max)} that best solve the user's request.`,
        `Return ONLY an object {"tools": ["name1", ...]} with 1..${String(max)} tools. No prose.`,
        "Use names exactly from the list.",
        "Rules:",
        "- If the intent is editorial (summarize/compose/edit/write/add/insert), you MUST include at least one writing tool: insertMarkdown OR insertHeadingNode OR insertTextNode.",
        "- Avoid chat-only tools (sendReply, requestClarificationOrPlan) when the user intent is clearly editorial.",
        "- If the user mentions an article or a URL and extractWebpageContent is available, prefer including it together with a writing tool.",
        "Examples:",
        'AVAILABLE_TOOLS: insertMarkdown, insertHeadingNode, insertTextNode\nUSER_PROMPT: add a title and a paragraph\nOUTPUT: {"tools": ["insertHeadingNode", "insertTextNode"]}',
        'AVAILABLE_TOOLS: requestClarificationOrPlan, sendReply\nUSER_PROMPT: not sure what I want\nOUTPUT: {"tools": ["requestClarificationOrPlan"]}',
        'AVAILABLE_TOOLS: extractWebpageContent, insertMarkdown, sendReply\nUSER_PROMPT: summarize this article\nOUTPUT: {"tools": ["extractWebpageContent", "insertMarkdown"]}',
      ].join("\n\n");

      const plannerPrompt = [
        "AVAILABLE_TOOLS:",
        availableTools.join(", "),
        "USER_PROMPT:",
        prompt,
      ].join("\n\n");

      const correlationId = generateUUID();
      const runOnce = async (which: "primary" | "fallback") => {
        const activeModel = which === "primary" ? model : fallbackModel;
        if (!activeModel) throw new Error("No planner model available");
        const Schema = z.object({
          tools: z.array(z.string()).min(1).max(Math.min(max, 6)),
        });
        const res = await generateObject({
          model: activeModel as unknown as LanguageModel,
          schema: Schema,
          prompt: plannerPrompt,
          system: plannerSystem,
          temperature: 0,
          // no tools in planner
        });
        const names = (res.object?.tools ?? []) as string[];
        log("model_output_full", {
          userId,
          raw: JSON.stringify(res.object ?? {}),
        });
        const set = new Set(availableTools);
        const selected = Array.from(
          new Set(names.filter((n) => set.has(n)).slice(0, max)),
        );
        return selected;
      };

      try {
        let selected = await runOnce("primary");
        if (selected.length === 0 && fallbackModel) {
          log("retry_planner", { userId });
          selected = await runOnce("fallback");
        }
        // Guardrails: ensure editorial coverage
        const writingSet = new Set([
          "insertMarkdown",
          "insertHeadingNode",
          "insertTextNode",
        ]);
        const chatOnlySet = new Set([
          "sendReply",
          "requestClarificationOrPlan",
        ]);
        const isEditorial =
          /\b(summarize|summary|compose|write|edit|draft|add|insert)\b/i.test(
            prompt,
          );
        const mentionsArticle = /\b(article|url|https?:\/\/)\b/i.test(prompt);

        if (isEditorial) {
          // Remove chat-only tools unless they are the only options
          const nonChat = selected.filter((n) => !chatOnlySet.has(n));
          if (nonChat.length > 0) selected = nonChat;

          // Ensure at least one writing tool present
          if (!selected.some((n) => writingSet.has(n))) {
            if (availableTools.includes("insertMarkdown")) {
              selected.unshift("insertMarkdown");
            } else if (availableTools.includes("insertHeadingNode")) {
              selected.unshift("insertHeadingNode");
              if (
                availableTools.includes("insertTextNode") &&
                selected.length < max
              )
                selected.push("insertTextNode");
            } else if (availableTools.includes("insertTextNode")) {
              selected.unshift("insertTextNode");
            }
          }

          // Prefer extraction when article/URL is present
          if (
            mentionsArticle &&
            availableTools.includes("extractWebpageContent") &&
            !selected.includes("extractWebpageContent") &&
            selected.length < max
          ) {
            selected.unshift("extractWebpageContent");
          }
        }

        const elapsedMs = Date.now() - startMs;
        log("selection_summary", {
          userId,
          selectedCount: selected.length,
          selectedNames: selected,
          latencyMs: elapsedMs,
          correlationId,
        });
        if (selected.length === 0) {
          log("empty_selection", {
            userId,
            reason: "Planner returned empty tools after retry",
            correlationId,
          });
          throw new TRPCError({
            code: "UNPROCESSABLE_CONTENT",
            message: "Planner failed to select tools",
          });
        }
        return { tools: selected, correlationId };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const elapsedMs = Date.now() - startMs;
        log("request_error", {
          userId,
          provider,
          modelId,
          latencyMs: elapsedMs,
          error: msg,
        });
        if (e instanceof TRPCError) {
          throw e;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: msg || "Planner error",
        });
      }
    }),

  agent: protectedProcedure.input(z.object({})).mutation(async ({ ctx }) => {
    const userId = ctx.session?.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    // If client-orchestrated mode is enabled, short-circuit to reduce duplication
    return {
      text: "",
      toolCalls: [],
    };
  }),
});
