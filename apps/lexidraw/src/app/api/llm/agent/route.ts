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
    messages: z.array(z.any()).optional(),
    system: z.string().optional(),
    documentId: z.string(),
  });

  const parsed = BodySchema.parse(await req.json());
  const {
    prompt,
    originalPrompt,
    documentMarkdown,
    messages,
    system,
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
  const workflowArgs: AgentWorkflowArgs = {
    prompt, // Formatted prompt for LLM
    originalPrompt: originalPrompt ?? prompt, // Use originalPrompt if provided, fallback to prompt
    documentMarkdown,
    messages: messages ?? [],
    system: system ?? "",
    config,
    userId,
    documentId,
    runId: generateUUID(),
  };

  const run = await start(agentWorkflow, [workflowArgs]);
  return new Response(run.getReadable<Uint8Array>(), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
