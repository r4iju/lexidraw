import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject, type LanguageModel } from "ai";
import env from "@packages/env";

export interface PlanToolsArgs {
  prompt: string;
  availableTools: string[];
  documentMarkdown?: string;
  max: number;
  provider: string;
}

export interface PlanToolsResult {
  tools: string[];
}

/**
 * Server-side planner utility that can be used from router or workflows.
 * Uses non-reasoning small models, allows 0..max tools, and is resilient to model errors.
 */
export async function planTools(args: PlanToolsArgs): Promise<PlanToolsResult> {
  const { prompt, availableTools, documentMarkdown, max, provider } = args;

  if (!Array.isArray(availableTools) || availableTools.length === 0) {
    return { tools: [] };
  }

  const openaiApiKey = env.OPENAI_API_KEY;
  const googleApiKey = env.GOOGLE_API_KEY;

  type PlannerModel =
    | ReturnType<ReturnType<typeof createOpenAI>>
    | ReturnType<ReturnType<typeof createGoogleGenerativeAI>>;

  let model: PlannerModel | null = null;
  if (provider === "openai") {
    if (!openaiApiKey) throw new Error("Missing OpenAI API key");
    const openai = createOpenAI({ apiKey: openaiApiKey });
    model = openai("gpt-5-nano");
  } else if (provider === "google") {
    if (!googleApiKey) throw new Error("Missing Google API key");
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    model = google("gemini-2.5-flash");
  } else {
    throw new Error("Unsupported provider");
  }

  const plannerSystem = [
    "You are a tool selection planner.",
    `From the provided list of available tool names, choose at most ${String(max)} that best solve the user's request.`,
    `Return ONLY an object {"tools": ["name1", ...]} with 0..${String(max)} tools. No prose.`,
    "Use names exactly from the list.",
  ].join("\n\n");

  let md = (documentMarkdown ?? "").toString();
  const MAX_MD = 16_000; // 16KB cap
  let mdTruncated = false;
  if (md.length > MAX_MD) {
    md = md.slice(0, MAX_MD) + "\n\n...[truncated]";
    mdTruncated = true;
  }

  const sections: string[] = [
    "AVAILABLE_TOOLS:",
    availableTools.join(", "),
    "USER_PROMPT:",
    prompt,
  ];
  if (md) {
    sections.push("DOCUMENT_MARKDOWN:");
    sections.push(md);
  }
  const plannerPrompt = sections.join("\n\n");

  const Schema = z.object({
    tools: z.array(z.string()).min(0).max(Math.min(max, 6)),
  });

  try {
    const res = await generateObject({
      model: model as unknown as LanguageModel,
      schema: Schema,
      prompt: plannerPrompt,
      system: plannerSystem,
    });
    const names = (
      res.object &&
      typeof res.object === "object" &&
      "tools" in res.object &&
      Array.isArray(res.object.tools)
        ? (res.object.tools as string[])
        : []
    ).filter((n) => availableTools.includes(n));
    const selected = names.slice(0, max);
    console.log(
      "[planner] composed",
      JSON.stringify({
        availableCount: availableTools.length,
        mdLen: (documentMarkdown ?? "").length,
        mdTruncated,
        selectedCount: selected.length,
      }),
    );
    return { tools: selected };
  } catch {
    return { tools: [] };
  }
}
