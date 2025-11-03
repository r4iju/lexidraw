import { drizzle, schema } from "@packages/drizzle";

export async function updateJobStatusStep(
  docKey: string,
  documentId: string,
  status: "processing" | "ready" | "queued",
  plannedCount?: number,
): Promise<void> {
  "use step";
  const updateData: {
    status: "processing" | "ready" | "queued";
    updatedAt: Date;
    plannedCount?: number | null;
  } = {
    status,
    updatedAt: new Date(),
  };
  if (plannedCount !== undefined) {
    updateData.plannedCount = plannedCount;
  }

  await drizzle
    .insert(schema.ttsJobs)
    .values({
      id: docKey,
      documentId,
      userId: "system",
      status,
      plannedCount: plannedCount ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof schema.ttsJobs.$inferInsert)
    .onConflictDoUpdate({
      target: schema.ttsJobs.id,
      set: updateData,
    })
    .execute();
}
