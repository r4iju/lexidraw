import { and, drizzle, eq, schema } from "@packages/drizzle";

/** Whether `runId` still makes `docKey`'s audio: the job is there, is its own, and wasn't cancelled. */
export async function runIsCurrentStep(
  docKey: string,
  runId: string,
): Promise<boolean> {
  "use step";
  const [job] = await drizzle
    .select({ status: schema.ttsJobs.status })
    .from(schema.ttsJobs)
    .where(and(eq(schema.ttsJobs.id, docKey), eq(schema.ttsJobs.runId, runId)))
    .limit(1);
  return job !== undefined && job.status !== "cancelled";
}
