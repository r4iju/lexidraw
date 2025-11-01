import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import env from "@packages/env";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  prompt: z.string().min(1),
  availableTools: z.array(z.string()).default([]),
  max: z.number().int().min(1).max(10).default(6),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const isDev = process.env.NODE_ENV !== "production";
  const log = (event: string, data: Record<string, unknown>) => {
    if (!isDev) return;
    try {
      // Keep logs structured for easy search in dev tools
      console.log(
        JSON.stringify({
          source: "planner",
          event,
          route: "/api/llm/plan",
          ...data,
        }),
      );
    } catch {
      // ignore logging failures
    }
  };

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { prompt, availableTools, max } = parsed;

  const cfg = await getEffectiveLlmConfig({
    mode: "agent",
    userConfig: session.user.config?.llm as {
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
      return new Response("Missing OpenAI API key", { status: 400 });
    const openai = createOpenAI({ apiKey: openaiApiKey });
    model = openai("gpt-4o-mini");
    fallbackModel = openai("gpt-4o");
  } else if (provider === "google") {
    if (!googleApiKey)
      return new Response("Missing Google API key", { status: 400 });
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    model = google("gemini-1.5-flash");
    fallbackModel = google("gemini-1.5-pro");
  } else {
    return new Response("Unsupported provider", { status: 400 });
  }

  const startMs = Date.now();
  log("request_start", {
    userId: session.user.id,
    provider,
    modelId,
    promptLen: prompt.length,
    availableCount: availableTools.length,
    max,
  });
  // In dev, log full user prompt and available tool names for diagnostics
  log("request_debug", {
    userId: session.user.id,
    prompt,
    availableTools,
  });

  const plannerSystem = [
    "You are a tool selection planner.",
    `From the provided list of available tool names, choose at most ${String(max)} that best solve the user\'s request.`,
    `Return ONLY an object {"tools": ["name1", ...]} with 1..${String(max)} tools. No prose.`,
    "Use names exactly from the list.",
    "Examples:",
    // Few-shot examples
    'AVAILABLE_TOOLS: insertMarkdown, insertHeadingNode, insertTextNode\nUSER_PROMPT: add a title and a paragraph\nOUTPUT: {"tools": ["insertHeadingNode", "insertTextNode"]}',
    'AVAILABLE_TOOLS: requestClarificationOrPlan, sendReply\nUSER_PROMPT: not sure what I want\nOUTPUT: {"tools": ["requestClarificationOrPlan"]}',
  ].join("\n\n");

  const plannerPrompt = [
    "AVAILABLE_TOOLS:",
    availableTools.join(", "),
    "USER_PROMPT:",
    prompt,
  ].join("\n\n");

  const correlationId = crypto.randomUUID();
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
      userId: session.user.id,
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
      log("retry_planner", { userId: session.user.id });
      selected = await runOnce("fallback");
    }
    const elapsedMs = Date.now() - startMs;
    log("selection_summary", {
      userId: session.user.id,
      selectedCount: selected.length,
      selectedNames: selected,
      latencyMs: elapsedMs,
      correlationId,
    });
    if (selected.length === 0) {
      log("empty_selection", {
        userId: session.user.id,
        reason: "Planner returned empty tools after retry",
        correlationId,
      });
      return Response.json(
        {
          error: "Planner failed to select tools",
          correlationId,
        },
        { status: 422 },
      );
    }
    return Response.json({ tools: selected, correlationId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const elapsedMs = Date.now() - startMs;
    log("request_error", {
      userId: session.user.id,
      provider,
      modelId,
      latencyMs: elapsedMs,
      error: msg,
    });
    return new Response(msg || "Planner error", { status: 500 });
  }
}
