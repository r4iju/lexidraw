import { drizzle, schema, eq } from "@packages/drizzle";

export async function updateProgressStep(
  docKey: string,
  completedSegments: number,
): Promise<void> {
  "use step";
  await drizzle
    .update(schema.ttsJobs)
    .set({
      segmentCount: completedSegments,
      updatedAt: new Date(),
    })
    .where(eq(schema.ttsJobs.id, docKey))
    .execute();
}
