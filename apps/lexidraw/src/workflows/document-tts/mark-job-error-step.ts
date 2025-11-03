import { drizzle, schema, eq } from "@packages/drizzle";

export async function markJobErrorStep(
  docKey: string,
  message: string,
): Promise<void> {
  "use step";
  await drizzle
    .update(schema.ttsJobs)
    .set({
      status: "error",
      error: message,
      updatedAt: new Date(),
    })
    .where(eq(schema.ttsJobs.id, docKey))
    .execute();
}
