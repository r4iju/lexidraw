import type { NextRequest } from "next/server";
import type { ModelMessage } from "ai";
import { auth } from "~/server/auth";
import { start } from "workflow/api";
import {
  agentWorkflow,
  type AgentWorkflowArgs,
} from "~/workflows/agent/agent-workflow";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { drizzle, schema, and, eq, isNull, or, ne } from "@packages/drizzle";
import { PublicAccess } from "@packages/types";
import { generateUUID } from "~/lib/utils";
import z from "zod";

async function assertCanAccessDocumentOrThrow(
  userId: string | undefined,
  documentId: string,
): Promise<void> {
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const rows = await drizzle
    .select({ id: schema.entities.id })
    .from(schema.entities)
    .leftJoin(
      schema.sharedEntities,
      eq(schema.sharedEntities.entityId, schema.entities.id),
    )
    .where(
      and(
        eq(schema.entities.id, documentId),
        eq(schema.entities.entityType, "document"),
        isNull(schema.entities.deletedAt),
        or(
          eq(schema.entities.userId, userId),
          eq(schema.sharedEntities.userId, userId),
          ne(schema.entities.publicAccess, PublicAccess.PRIVATE),
        ),
      ),
    )
    .limit(1)
    .execute();

  if (!rows[0]) {
    throw new Error("Unauthorized");
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  } else {
    console.log("[agent] authenticated");
  }

  const userId = session.user.id;

  const BodySchema = z.object({
    prompt: z.string(),
    originalPrompt: z.string().min(1).optional(),
    documentMarkdown: z.string().min(1).optional(),
    documentJson: z.record(z.string(), z.unknown()).optional(),
    messages: z.array(z.any()).optional(),
    documentId: z.string(),
  });

  const parsed = BodySchema.parse(await req.json());
  const {
    prompt,
    originalPrompt,
    documentMarkdown,
    documentJson,
    messages,
    documentId,
  } = parsed;
  console.log({ parsed });

  // Authorize document access
  try {
    await assertCanAccessDocumentOrThrow(userId, documentId);
    console.log("[agent] authorized");
  } catch (error) {
    console.error("[agent] unauthorized", error);
    throw new Error("Unauthorized");
  }

  // Get effective LLM config
  const config = await getEffectiveLlmConfig({
    mode: "agent",
    userConfig: session.user.config?.llm as {
      agent?: {
        provider: string;
        modelId: string;
        temperature: number;
        maxOutputTokens: number;
      };
    },
  });

  // Prepare workflow args
  const runId = generateUUID();
  function coerceToModelMessages(input: unknown): ModelMessage[] {
    if (!Array.isArray(input)) return [];
    const out: ModelMessage[] = [];
    for (const item of input as unknown[]) {
      const maybe = item as Record<string, unknown>;
      const roleRaw = maybe?.role;
      const contentRaw = maybe?.content;
      const role =
        roleRaw === "user" ||
        roleRaw === "assistant" ||
        roleRaw === "system" ||
        roleRaw === "tool"
          ? (roleRaw as "user" | "assistant" | "system" | "tool")
          : ("user" as const);

      // Prefer string content; otherwise stringify to ensure validity
      let content: string | { type: string; [k: string]: unknown }[];
      if (typeof contentRaw === "string") {
        content = contentRaw;
      } else if (Array.isArray(contentRaw)) {
        // Only accept an array if every part has a string 'type'
        const ok = (contentRaw as unknown[]).every(
          (p) => typeof (p as Record<string, unknown>)?.type === "string",
        );
        content = ok
          ? (contentRaw as { type: string }[])
          : JSON.stringify(contentRaw);
      } else if (contentRaw && typeof contentRaw === "object") {
        content = JSON.stringify(contentRaw);
      } else {
        content = "";
      }

      if (role === "tool") {
        const toolCallId = maybe?.toolCallId;
        if (typeof toolCallId === "string" && typeof content === "string") {
          out.push({ role: "tool", content, toolCallId });
          continue;
        }
        // If malformed, fall back to a plain assistant message
        out.push({
          role: "assistant",
          content:
            typeof content === "string" ? content : JSON.stringify(content),
        });
        continue;
      }

      out.push({ role, content });
    }
    return out;
  }

  const safeMessages: ModelMessage[] = coerceToModelMessages(messages);
  const workflowArgs: AgentWorkflowArgs = {
    prompt, // Just the user's prompt
    originalPrompt: originalPrompt ?? prompt, // Use originalPrompt if provided, fallback to prompt
    documentMarkdown,
    documentJson,
    messages: safeMessages,
    config,
    userId,
    documentId,
    runId,
  };

  const run = await start(agentWorkflow, [workflowArgs]);
  const readable = run.getReadable<Uint8Array>();

  // Handle abort signal: close the stream when request is aborted
  req.signal.addEventListener("abort", () => {
    console.log(`[agent] Request aborted for runId: ${runId}`);
    // Stream will be closed when readable is consumed/closed
    // The workflow will continue but won't send events to a closed stream
    readable.cancel?.().catch(() => {
      // Ignore errors when canceling
    });
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
