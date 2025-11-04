import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { start } from "workflow/api";
import {
  agentWorkflow,
  type AgentWorkflowArgs,
} from "~/workflows/agent/agent-workflow";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { drizzle, schema, and, eq, isNull, or, ne } from "@packages/drizzle";
import { PublicAccess } from "@packages/types";
import type { ModelMessage } from "ai";
import { generateUUID } from "~/lib/utils";

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
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  let body: {
    prompt: string; // Formatted prompt for LLM
    originalPrompt?: string; // Original user prompt for planner
    documentMarkdown?: string; // Markdown snapshot for planner
    messages?: ModelMessage[];
    system?: string;
    documentId: string;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.prompt || !body.documentId) {
    return new Response("Missing required fields: prompt, documentId", {
      status: 400,
    });
  }

  // Authorize document access
  try {
    await assertCanAccessDocumentOrThrow(userId, body.documentId);
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Unauthorized",
      { status: 403 },
    );
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
  const workflowArgs: AgentWorkflowArgs = {
    prompt: body.prompt, // Formatted prompt for LLM
    originalPrompt: body.originalPrompt ?? body.prompt, // Use originalPrompt if provided, fallback to prompt
    documentMarkdown: body.documentMarkdown,
    messages: body.messages ?? [],
    system: body.system ?? "",
    config,
    userId,
    documentId: body.documentId,
    runId: generateUUID(),
  };

  // Start workflow
  const run = await start(agentWorkflow, [workflowArgs]);

  // Return run.readable directly as NDJSON stream (per docs pattern)
  const stream = run.getReadable<Uint8Array>();

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
