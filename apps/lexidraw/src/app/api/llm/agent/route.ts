import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { drizzle, schema, and, eq, isNull, or, ne } from "@packages/drizzle";
import { PublicAccess } from "@packages/types";
import z from "zod";

async function canReadDocument(
  userId: string,
  documentId: string,
): Promise<boolean> {
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

  return Boolean(rows[0]);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;

  const BodySchema = z.object({
    prompt: z.string(),
    originalPrompt: z.string().min(1).optional(),
    documentMarkdown: z.string().min(1).optional(),
    documentJson: z.record(z.string(), z.unknown()).optional(),
    messages: z.array(z.unknown()).optional(),
    documentId: z.string(),
    serverCodeMode: z.boolean().optional(),
  });

  const parsed = BodySchema.parse(await req.json());
  const { documentId } = parsed;

  // Not found rather than forbidden, so the answer does not tell a stranger
  // the document exists.
  if (!(await canReadDocument(userId, documentId))) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(
    "Use the bounded Pro document action. Legacy agent forwarding is unavailable.",
    { status: 410 },
  );
}
