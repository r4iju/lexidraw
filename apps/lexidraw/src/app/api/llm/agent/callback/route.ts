import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { verifyHookToken } from "~/server/auth/hook-token";
import { ToolCallbackBodySchema } from "@packages/types";
import { drizzle, schema, and, eq, isNull, or, ne } from "@packages/drizzle";
import { PublicAccess } from "@packages/types";
import { resumeHook } from "workflow/api";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Validate request body
  const validationResult = ToolCallbackBodySchema.safeParse(body);
  if (!validationResult.success) {
    return new Response("Invalid request body", { status: 400 });
  }

  const { hookToken, toolCallId, result } = validationResult.data;

  // Verify hook token (JWT for security validation)
  // Note: The hookToken in the event is the workflow hook token, but we may also
  // receive a JWT token for validation. For now, we'll verify the workflow hook token
  // directly via resumeHook, but we should verify access separately.
  // TODO: Store JWT token separately in event for validation

  // Verify document access via session (hook token validation happens in resumeHook)
  try {
    // Extract runId from hook token if possible, or validate via session
    // For now, validate document access via session user
    const jwtPayload = verifyHookToken(hookToken);
    if (jwtPayload) {
      // If it's a JWT token, verify user and document access
      if (jwtPayload.userId !== session.user.id) {
        return new Response("User mismatch", { status: 403 });
      }
      await assertCanAccessDocumentOrThrow(
        session.user.id,
        jwtPayload.documentId,
      );
      if (jwtPayload.toolCallId !== toolCallId) {
        return new Response("Tool call ID mismatch", { status: 400 });
      }
    } else {
      // If not a JWT, it's a workflow hook token - verify access via session
      // We'll need to store documentId in the hook context or verify separately
      // For now, skip JWT validation for workflow hook tokens
    }
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Unauthorized",
      { status: 403 },
    );
  }

  // Resume workflow hook with result
  try {
    await resumeHook(hookToken, { toolCallId, result });
  } catch (error) {
    // Hook may have already been resumed or invalid
    console.error("[callback] Failed to resume hook:", error);
    return new Response(
      error instanceof Error ? error.message : "Failed to resume hook",
      { status: 400 },
    );
  }

  return new Response(null, { status: 204 });
}
